import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  workspaceFileSchema,
  type WorkspaceFileName,
  type WorkspaceFiles,
} from '@travelclaw/shared';
import { loadConfig } from '../config';

const FILES: WorkspaceFileName[] = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'AGENTS.md',
  'MEMORY.md',
];

const FALLBACK: Record<WorkspaceFileName, string> = {
  'SOUL.md': '# Soul\n\nYou are Marlow. Be specific. Never claim a booking.\n',
  'IDENTITY.md':
    '# Identity\n\n- Name: Marlow\n- Emoji: compass\n- Role: Travel desk\n- Model: travelclaw-local\n- Description: Plans from the traveler constraints.\n',
  'USER.md': '# Traveler\n\n- Name: Traveler\n- Address as: you\n',
  'AGENTS.md': '# Desk rules\n\n- One gateway owns sessions.\n',
  'MEMORY.md': '# Memory\n',
};

@Injectable()
export class WorkspaceService implements OnModuleInit {
  private root = '';

  onModuleInit() {
    this.root = loadConfig().workspacePath;
    mkdirSync(this.root, { recursive: true });
    const template = findTemplateWorkspace();
    for (const file of FILES) {
      const target = this.resolveFile(file);
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

  readFiles(): WorkspaceFiles {
    return {
      soul: this.read('SOUL.md'),
      identity: this.read('IDENTITY.md'),
      user: this.read('USER.md'),
      agents: this.read('AGENTS.md'),
      memory: this.read('MEMORY.md'),
    };
  }

  read(file: WorkspaceFileName): string {
    return readFileSync(this.resolveFile(file), 'utf8');
  }

  write(file: WorkspaceFileName, content: string) {
    const parsed = workspaceFileSchema.safeParse(file);
    if (!parsed.success) throw new BadRequestException('That file is not editable');
    writeFileSync(
      this.resolveFile(parsed.data),
      content.endsWith('\n') ? content : `${content}\n`,
    );
    return this.readFiles();
  }

  appendMemory(line: string) {
    const file = this.resolveFile('MEMORY.md');
    const current = readFileSync(file, 'utf8');
    if (current.includes(line)) return;
    const next = current.trimEnd() + `\n${line}\n`;
    writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`);
    const day = new Date().toISOString().slice(0, 10);
    const daily = resolve(this.root, 'memory', `${day}.md`);
    const existing = existsSync(daily) ? readFileSync(daily, 'utf8') : `# ${day}\n`;
    if (!existing.includes(line)) writeFileSync(daily, `${existing.trimEnd()}\n${line}\n`);
  }

  identityField(label: string): string | undefined {
    return new RegExp(`^- ${label}:\\s*(.+)$`, 'm')
      .exec(this.read('IDENTITY.md'))?.[1]
      ?.trim();
  }

  private resolveFile(file: WorkspaceFileName): string {
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
