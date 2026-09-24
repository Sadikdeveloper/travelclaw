import { Injectable, OnModuleInit } from '@nestjs/common';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUNDLED_SKILLS, parseSkillMarkdown, type SkillDoc } from '@travelclaw/agent-core';
import type { SkillRecord, SkillRunRecord } from '@travelclaw/shared';
import { newId, nowIso } from '../common/util';
import { DatabaseService } from '../db/database.service';

interface RunRow {
  id: string;
  session_id: string | null;
  trip_id: string | null;
  skill: string;
  ok: number;
  summary: string;
  created_at: string;
}

@Injectable()
export class SkillsService implements OnModuleInit {
  private docs: SkillDoc[] = [];

  constructor(private readonly db: DatabaseService) {}

  onModuleInit() {
    this.docs = this.load();
  }

  list(): SkillRecord[] {
    const implemented = new Set(BUNDLED_SKILLS.map((skill) => skill.name));
    return this.docs.map((doc) => ({
      name: doc.name,
      description: doc.description,
      triggers: doc.triggers,
      implemented: implemented.has(doc.name),
    }));
  }

  docsForTurn(): SkillDoc[] {
    return this.docs;
  }

  record(input: { sessionId?: string; tripId?: string; skill: string; ok: boolean; summary: string }) {
    this.db.run(
      `INSERT INTO skill_runs (id, session_id, trip_id, skill, ok, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      input.sessionId || null,
      input.tripId || null,
      input.skill,
      input.ok ? 1 : 0,
      input.summary,
      nowIso(),
    );
  }

  recent(limit = 20): SkillRunRecord[] {
    return this.db
      .all<RunRow>('SELECT * FROM skill_runs ORDER BY created_at DESC LIMIT ?', limit)
      .map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        tripId: row.trip_id,
        skill: row.skill,
        ok: row.ok === 1,
        summary: row.summary,
        createdAt: row.created_at,
      }));
  }

  private load(): SkillDoc[] {
    const root = findSkillsRoot();
    const fromDisk: SkillDoc[] = [];
    if (root) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = join(root, entry.name, 'SKILL.md');
        if (!existsSync(file)) continue;
        const parsed = parseSkillMarkdown(readFileSync(file, 'utf8'));
        if (parsed) fromDisk.push(parsed);
      }
    }
    const byName = new Map(fromDisk.map((doc) => [doc.name, doc]));
    for (const skill of BUNDLED_SKILLS) {
      if (!byName.has(skill.name)) {
        byName.set(skill.name, {
          name: skill.name,
          description: skill.description,
          triggers: skill.triggers,
          body: '',
        });
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

function findSkillsRoot(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, 'skills');
    if (existsSync(join(candidate, 'trip.outline', 'SKILL.md'))) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
