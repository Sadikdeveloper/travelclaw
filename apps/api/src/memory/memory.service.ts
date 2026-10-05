import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { fitMemoryLines, MEMORY_MAX_LINES } from '@travelclaw/agent-core';
import type {
  CreateMemoryInput,
  MemoryKind,
  MemoryRecord,
  MemorySearchResult,
} from '@travelclaw/shared';
import { newId, nowIso } from '../common/util';
import { DatabaseService } from '../db/database.service';
import { MEMORY_FTS_TABLE } from '../db/memory-search-schema';
import { AgentsService } from '../agents/agents.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { formatMemoryBullet, parseMemoryBullets } from './bullet';
import {
  bm25RankToScore,
  BODY_WEIGHT,
  buildMatchQuery,
  compareScoredNotes,
  coverageRelevance,
  escapeLike,
  hasUnsegmentedRun,
  recencyFactor,
  searchTerms,
  TITLE_WEIGHT,
  type ScoredNote,
} from './fts';

interface MemoryRow {
  id: string;
  agent_id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  note_date: string | null;
  created_at: string;
}

interface RankedMemoryRow extends MemoryRow {
  /** `bm25()`: more negative is a better match. */
  rank_score: number;
}

const LIST_LIMIT = 100;
const SEARCH_LIMIT = 10;
/**
 * Recency can only reorder candidates it was shown, so a search reads more rows
 * than it returns (OpenClaw's candidate multiplier) before re-ranking.
 */
const CANDIDATE_MULTIPLIER = 4;

/**
 * Memory notes and the local search over them (issue #6). `memory_notes` is the
 * note; `MEMORY.md` is the human-readable copy; `memory_notes_fts` is a derived
 * index the triggers and the boot reconcile keep in step with the table. Search
 * never adds a second source of truth and never leaves SQLite.
 */
@Injectable()
export class MemoryService implements OnModuleInit {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly agents: AgentsService,
    private readonly workspace: WorkspaceService,
  ) {}

  onModuleInit() {
    // Import the MEMORY.md each agent actually reads: its own
    // workspace/agents/<id>/MEMORY.md when present, the shared desk file otherwise.
    // The import is idempotent, so restarts and agents without an override are safe.
    for (const agent of this.agents.list()) this.importFile(agent.id);
  }

  list(
    agentId?: string,
    options: { kind?: MemoryKind; limit?: number } = {},
  ): MemoryRecord[] {
    const id = agentId || this.agents.defaultAgent().id;
    const limit = options.limit ?? LIST_LIMIT;
    return this.db
      .all<MemoryRow>(
        `SELECT * FROM memory_notes WHERE agent_id = ?${options.kind ? ' AND kind = ?' : ''}
         ORDER BY created_at DESC LIMIT ?`,
        ...(options.kind ? [id, options.kind, limit] : [id, limit]),
      )
      .map(mapMemory);
  }

  /**
   * Rank the notes that answer `query`, best first: BM25 over title and body,
   * title weighted higher, times a bounded recency factor. `[]` when the query has
   * no words in it — an empty MATCH is an FTS5 syntax error, and a scan with no
   * pattern would return every note the agent has.
   */
  search(
    agentId: string | undefined,
    query: string,
    options: { kind?: MemoryKind; limit?: number } = {},
  ): MemorySearchResult[] {
    const id = agentId || this.agents.defaultAgent().id;
    const limit = options.limit ?? SEARCH_LIMIT;
    const terms = searchTerms(query);
    if (terms.length === 0) return [];
    // A script the tokenizer cannot segment takes the scan: unicode61 keeps a run
    // of ideographs as one token, so a query for part of it can never match.
    const rows =
      this.db.hasMemoryFts() && !hasUnsegmentedRun(query)
        ? this.matchRows(id, terms, options.kind, limit)
        : this.scanRows(id, terms, options.kind, limit);
    return this.rank(rows, limit);
  }

  /**
   * The memory lines for one turn: what the traveler just asked about first, then
   * the most recent notes to fill the rest. Search picks which notes matter;
   * `fitMemoryLines` in agent-core owns the byte budget, so a turn costs what it
   * cost when this was simply the last twelve bullets.
   */
  promptLines(agentId: string, query?: string): string[] {
    const notes: MemoryRecord[] = [];
    const seen = new Set<string>();
    const take = (note: MemoryRecord) => {
      if (notes.length >= MEMORY_MAX_LINES || seen.has(note.id)) return;
      seen.add(note.id);
      notes.push(note);
    };
    if (query && query.trim()) {
      for (const hit of this.search(agentId, query, { limit: MEMORY_MAX_LINES })) take(hit);
    }
    for (const note of this.list(agentId)) take(note);
    return fitMemoryLines(notes.map((note) => `[${note.kind}] ${note.body}`));
  }

  remember(
    agentId: string,
    input: { kind: MemoryKind; title: string; body: string; noteDate?: string },
  ): MemoryRecord {
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
    this.workspace.appendMemory(
      formatMemoryBullet(input.kind, input.body, noteDate),
      agentId,
    );
    return this.mustGet(id);
  }

  create(input: CreateMemoryInput): MemoryRecord {
    const agent = this.agents.resolve(input.agentId);
    const body = input.body.replace(/\s+/g, ' ').trim();
    const title = input.title || (body.length > 52 ? `${body.slice(0, 52)}…` : body);
    return this.remember(agent.id, { kind: input.kind, title, body });
  }

  /**
   * Forget a note: the row, and the bullet in the `MEMORY.md` that agent reads.
   * Removing only the row would resurrect the note on the next boot, because the
   * file is imported on start. The daily journal keeps its line as a log.
   */
  forget(agentId: string | undefined, id: string): void {
    const agent = this.agents.resolve(agentId);
    const row = this.db.get<MemoryRow>(
      'SELECT * FROM memory_notes WHERE id = ? AND agent_id = ?',
      id,
      agent.id,
    );
    if (!row) throw new NotFoundException(`No memory note ${id}`);
    this.db.run('DELETE FROM memory_notes WHERE id = ?', id);
    if (!this.workspace.removeMemory(row.body, agent.id)) {
      this.logger.warn(`Forgot ${id}; its bullet was not in MEMORY.md to remove`);
    }
  }

  /**
   * FTS5 ANDs its terms, so a question worded differently from the note it is
   * about matches nothing at all. On an empty strict search, retry OR-joined:
   * BM25 still ranks the note covering the most terms first, and a note covering
   * none is not returned.
   */
  private matchRows(
    agentId: string,
    terms: string[],
    kind: MemoryKind | undefined,
    limit: number,
  ): ScoredNote<MemoryRecord>[] {
    const strict = this.matchRowsFor(agentId, buildMatchQuery(terms, 'AND'), kind, limit);
    if (strict.length > 0 || terms.length < 2) return strict;
    return this.matchRowsFor(agentId, buildMatchQuery(terms, 'OR'), kind, limit);
  }

  private matchRowsFor(
    agentId: string,
    match: string | null,
    kind: MemoryKind | undefined,
    limit: number,
  ): ScoredNote<MemoryRecord>[] {
    if (!match) return [];
    const params: (string | number)[] = [match, agentId];
    let kindFilter = '';
    if (kind) {
      kindFilter = ` AND ${MEMORY_FTS_TABLE}.kind = ?`;
      params.push(kind);
    }
    params.push(limit * CANDIDATE_MULTIPLIER);
    return this.db
      .all<RankedMemoryRow>(
        `SELECT n.id, n.agent_id, n.kind, n.title, n.body, n.note_date, n.created_at,
                bm25(${MEMORY_FTS_TABLE}, ${TITLE_WEIGHT}, ${BODY_WEIGHT}) AS rank_score
         FROM ${MEMORY_FTS_TABLE}
         JOIN memory_notes n ON n.id = ${MEMORY_FTS_TABLE}.note_id
         WHERE ${MEMORY_FTS_TABLE} MATCH ? AND ${MEMORY_FTS_TABLE}.agent_id = ?${kindFilter}
         ORDER BY rank_score ASC
         LIMIT ?`,
        ...params,
      )
      .map((row) => ({ note: mapMemory(row), relevance: bm25RankToScore(row.rank_score) }));
  }

  /**
   * The fallback search: a substring scan over the notes themselves. It serves a
   * script FTS5 cannot segment, and any install whose SQLite has no FTS5. `%` and
   * `_` are escaped, so a traveler's literal percent is not a wildcard.
   */
  private scanRows(
    agentId: string,
    terms: string[],
    kind: MemoryKind | undefined,
    limit: number,
  ): ScoredNote<MemoryRecord>[] {
    const clause = terms
      .map(() => "(lower(title) LIKE ? ESCAPE '\\' OR lower(body) LIKE ? ESCAPE '\\')")
      .join(' OR ');
    const params: (string | number)[] = [agentId];
    if (kind) params.push(kind);
    for (const term of terms) {
      const pattern = `%${escapeLike(term)}%`;
      params.push(pattern, pattern);
    }
    params.push(limit * CANDIDATE_MULTIPLIER);
    return this.db
      .all<MemoryRow>(
        `SELECT * FROM memory_notes
         WHERE agent_id = ?${kind ? ' AND kind = ?' : ''} AND (${clause})
         ORDER BY created_at DESC
         LIMIT ?`,
        ...params,
      )
      .map((row) => {
        const note = mapMemory(row);
        return { note, relevance: coverageRelevance(note, terms) };
      });
  }

  private rank(rows: ScoredNote<MemoryRecord>[], limit: number): MemorySearchResult[] {
    const now = new Date();
    return rows
      .map((row) => ({
        ...row,
        score: row.relevance * recencyFactor(row.note.createdAt, now),
      }))
      .sort(compareScoredNotes)
      .slice(0, limit)
      .map((row) => ({ ...row.note, score: row.score }));
  }

  private importFile(agentId: string) {
    for (const bullet of parseMemoryBullets(this.workspace.read('MEMORY.md', agentId))) {
      const body = bullet.body;
      const title = body.length > 52 ? `${body.slice(0, 52)}…` : body;
      const existing = this.db.get(
        'SELECT id FROM memory_notes WHERE agent_id = ? AND body = ?',
        agentId,
        body,
      );
      if (existing) continue;
      this.db.run(
        `INSERT INTO memory_notes (id, agent_id, kind, title, body, note_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        agentId,
        bullet.kind,
        title,
        body,
        bullet.noteDate || null,
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
