import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  workspaceFileSchema,
  type WorkspaceFileName,
  type WorkspaceFileSource,
  type WorkspaceFiles,
  type WorkspaceView,
} from '@travelclaw/shared';
import { loadConfig } from '../config';
import { parseMemoryBullet } from '../memory/bullet';

const FILES: Record<keyof WorkspaceFiles, WorkspaceFileName> = {
  soul: 'SOUL.md',
  identity: 'IDENTITY.md',
  user: 'USER.md',
  agents: 'AGENTS.md',
  memory: 'MEMORY.md',
};

const FALLBACK: Record<WorkspaceFileName, string> = {
  'SOUL.md': '# Soul\n\nYou are Marlow. Be specific. Never claim a booking.\n',
  'IDENTITY.md':
    '# Identity\n\n- Name: Marlow\n- Emoji: compass\n- Role: Travel desk\n- Model: travelclaw-local\n- Description: Plans from the traveler constraints.\n',
  'USER.md': '# Traveler\n\n- Name: Traveler\n- Address as: you\n',
  'AGENTS.md': '# Desk rules\n\n- One gateway owns sessions.\n',
  'MEMORY.md': '# Memory\n',
};

/**
 * An agent id doubles as a folder name under `workspace/agents/`. Ids come from the
 * API (and from `?agentId=`), so treat them as untrusted input: one lowercase
 * segment, no separators, no dot runs — the id can never climb out of the workspace.
 */
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface ResolvedFile {
  path: string;
  source: WorkspaceFileSource['source'];
}

@Injectable()
export class WorkspaceService implements OnModuleInit {
  private root = '';

  onModuleInit() {
    this.root = loadConfig().workspacePath;
    mkdirSync(this.root, { recursive: true });
    const template = findTemplateWorkspace();
    for (const file of Object.values(FILES)) {
      const target = this.resolveShared(file);
      if (existsSync(target)) continue;
      if (template && existsSync(resolve(template, file))) {
        copyFileSync(resolve(template, file), target);
      } else {
        writeFileSync(target, FALLBACK[file]);
      }
    }
    mkdirSync(resolve(this.root, 'memory'), { recursive: true });
  }

  path(): string {
    return this.root;
  }

  readFiles(agentId?: string): WorkspaceFiles {
    return {
      soul: this.read('SOUL.md', agentId),
      identity: this.read('IDENTITY.md', agentId),
      user: this.read('USER.md', agentId),
      agents: this.read('AGENTS.md', agentId),
      memory: this.read('MEMORY.md', agentId),
    };
  }

  /** The persona files for one agent, with the file behind each slot named. */
  view(agentId?: string): WorkspaceView {
    return { ...this.readFiles(agentId), sources: this.sources(agentId) };
  }

  read(file: WorkspaceFileName, agentId?: string): string {
    return readFileSync(this.resolve(file, agentId).path, 'utf8');
  }

  write(file: WorkspaceFileName, content: string) {
    const parsed = workspaceFileSchema.safeParse(file);
    if (!parsed.success) throw new BadRequestException('That file is not editable');
    // Editing stays on the shared desk files. Per-agent overrides are operator files
    // dropped into workspace/agents/<id>/; there is no per-agent write API (issue #7).
    writeFileSync(
      this.resolveShared(parsed.data),
      content.endsWith('\n') ? content : `${content}\n`,
    );
    return this.view();
  }

  appendMemory(line: string, agentId?: string) {
    const file = this.resolve('MEMORY.md', agentId).path;
    const current = readFileSync(file, 'utf8');
    if (current.includes(line)) return;
    const next = current.trimEnd() + `\n${line}\n`;
    writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`);
    const day = new Date().toISOString().slice(0, 10);
    const daily = resolve(this.root, 'memory', `${day}.md`);
    const existing = existsSync(daily) ? readFileSync(daily, 'utf8') : `# ${day}\n`;
    if (!existing.includes(line)) writeFileSync(daily, `${existing.trimEnd()}\n${line}\n`);
  }

  /**
   * Drop a forgotten note's bullet from the `MEMORY.md` that agent reads. The file
   * is imported on boot, so a line left behind would put the row straight back.
   * The daily journal under `memory/<day>.md` is an append-only log of what the
   * desk wrote and keeps its line.
   */
  removeMemory(body: string, agentId?: string): boolean {
    const file = this.resolve('MEMORY.md', agentId).path;
    const current = readFileSync(file, 'utf8');
    const kept = current
      .split('\n')
      .filter((line) => parseMemoryBullet(line)?.body !== body)
      .join('\n');
    if (kept === current) return false;
    writeFileSync(file, kept.endsWith('\n') ? kept : `${kept}\n`);
    return true;
  }

  identityField(label: string, agentId?: string): string | undefined {
    return new RegExp(`^- ${label}:\\s*(.+)$`, 'm')
      .exec(this.read('IDENTITY.md', agentId))?.[1]
      ?.trim();
  }

  /**
   * One file, resolved the way the agent that asked reads it: its own
   * `workspace/agents/<id>/<file>` when that file exists, the shared desk file
   * otherwise — per file, so a partial override keeps the rest on the shared files.
   */
  private resolve(file: WorkspaceFileName, agentId?: string): ResolvedFile {
    const shared = this.resolveShared(file);
    if (!agentId) return { path: shared, source: 'shared' };
    const override = resolve(this.resolveAgentDir(agentId), file);
    return isFile(override)
      ? { path: override, source: 'agent' }
      : { path: shared, source: 'shared' };
  }

  private sources(agentId?: string): Record<keyof WorkspaceFiles, WorkspaceFileSource> {
    const out = {} as Record<keyof WorkspaceFiles, WorkspaceFileSource>;
    for (const [key, file] of Object.entries(FILES) as [
      keyof WorkspaceFiles,
      WorkspaceFileName,
    ][]) {
      const resolved = this.resolve(file, agentId);
      out[key] = {
        source: resolved.source,
        path: relative(this.root, resolved.path).split(sep).join('/'),
      };
    }
    return out;
  }

  private resolveShared(file: WorkspaceFileName): string {
    if (file.includes('/') || file.includes('\\') || file.includes('..')) {
      throw new BadRequestException('Path escapes the workspace');
    }
    const target = resolve(this.root, file);
    const rel = relative(this.root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new BadRequestException('Path escapes the workspace');
    }
    return target;
  }

  /** `workspace/agents/<id>/`, refused outright when the id is not one safe segment. */
  private resolveAgentDir(agentId: string): string {
    if (!AGENT_ID.test(agentId)) {
      throw new BadRequestException('That agent id is not a workspace folder');
    }
    const base = resolve(this.root, 'agents');
    const target = resolve(base, agentId);
    // Belt and braces: the pattern above already forbids separators and dot runs,
    // but never build a path from an id without checking where it lands.
    const rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new BadRequestException('That agent id is not a workspace folder');
    }
    return target;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findTemplateWorkspace(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, 'workspace', 'SOUL.md');
    if (existsSync(candidate)) return resolve(dir, 'workspace');
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
