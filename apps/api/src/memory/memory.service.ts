import { Injectable, OnModuleInit } from '@nestjs/common';
import type { CreateMemoryInput, MemoryKind, MemoryRecord } from '@travelclaw/shared';
import { newId, nowIso } from '../common/util';
import { DatabaseService } from '../db/database.service';
import { AgentsService } from '../agents/agents.service';
import { WorkspaceService } from '../workspace/workspace.service';

interface MemoryRow {
  id: string;
  agent_id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  note_date: string | null;
  created_at: string;
}

const BULLET = /^- \[(preference|fact|decision)\]\s+(.+?)(?:\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/gm;

@Injectable()
export class MemoryService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly agents: AgentsService,
    private readonly workspace: WorkspaceService,
  ) {}

  onModuleInit() {
    this.importFile(this.agents.defaultAgent().id);
  }

  list(agentId?: string): MemoryRecord[] {
    const id = agentId || this.agents.defaultAgent().id;
    return this.db
      .all<MemoryRow>(
        'SELECT * FROM memory_notes WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100',
        id,
      )
      .map(mapMemory);
  }

  recentLines(agentId: string, limit = 12): string[] {
    return this.list(agentId)
      .slice(0, limit)
      .reverse()
      .map((note) => `[${note.kind}] ${note.body}`);
  }

  remember(agentId: string, input: { kind: MemoryKind; title: string; body: string; noteDate?: string }): MemoryRecord {
    const existing = this.db.get<MemoryRow>(
      'SELECT * FROM memory_notes WHERE agent_id = ? AND body = ?',
      agentId,
      input.body,
    );
    if (existing) return mapMemory(existing);
    const now = nowIso();
    const id = newId();
    const noteDate = input.noteDate || now.slice(0, 10);
    this.db.run(
      `INSERT INTO memory_notes (id, agent_id, kind, title, body, note_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      agentId,
      input.kind,
      input.title,
      input.body,
      noteDate,
      now,
    );
    this.workspace.appendMemory(`- [${input.kind}] ${input.body} (${noteDate})`);
    return this.mustGet(id);
  }

  create(input: CreateMemoryInput): MemoryRecord {
    const agent = this.agents.resolve(input.agentId);
    const body = input.body.replace(/\s+/g, ' ').trim();
    const title = input.title || (body.length > 52 ? `${body.slice(0, 52)}…` : body);
    return this.remember(agent.id, { kind: input.kind, title, body });
  }

  private importFile(agentId: string) {
    const raw = this.workspace.read('MEMORY.md');
    for (const match of raw.matchAll(BULLET)) {
      const kind = match[1] as MemoryKind;
      const body = match[2].trim();
      const noteDate = match[3];
      const title = body.length > 52 ? `${body.slice(0, 52)}…` : body;
      const existing = this.db.get('SELECT id FROM memory_notes WHERE agent_id = ? AND body = ?', agentId, body);
      if (existing) continue;
      this.db.run(
        `INSERT INTO memory_notes (id, agent_id, kind, title, body, note_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        agentId,
        kind,
        title,
        body,
        noteDate || null,
        nowIso(),
      );
    }
  }

  private mustGet(id: string): MemoryRecord {
    const row = this.db.get<MemoryRow>('SELECT * FROM memory_notes WHERE id = ?', id);
    if (!row) throw new Error('Memory note disappeared after insert');
    return mapMemory(row);
  }
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    noteDate: row.note_date,
    createdAt: row.created_at,
  };
}
