import { Injectable } from '@nestjs/common';
import { BUNDLED_TOOLS } from '@travelclaw/agent-core';
import type { ToolRecord, ToolRunRecord } from '@travelclaw/shared';
import { newId, nowIso } from '../common/util';
import { DatabaseService } from '../db/database.service';

interface RunRow {
  id: string;
  session_id: string | null;
  trip_id: string | null;
  tool: string;
  ok: number;
  summary: string;
  created_at: string;
}

@Injectable()
export class ToolsService {
  constructor(private readonly db: DatabaseService) {}

  list(): ToolRecord[] {
    return BUNDLED_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      triggers: tool.triggers,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  record(input: {
    sessionId?: string;
    tripId?: string;
    tool: string;
    ok: boolean;
    summary: string;
  }) {
    this.db.run(
      `INSERT INTO tool_runs (id, session_id, trip_id, tool, ok, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      input.sessionId || null,
      input.tripId || null,
      input.tool,
      input.ok ? 1 : 0,
      input.summary,
      nowIso(),
    );
  }

  recent(limit = 20): ToolRunRecord[] {
    return this.db
      .all<RunRow>('SELECT * FROM tool_runs ORDER BY created_at DESC LIMIT ?', limit)
      .map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        tripId: row.trip_id,
        tool: row.tool,
        ok: row.ok === 1,
        summary: row.summary,
        createdAt: row.created_at,
      }));
  }
}
