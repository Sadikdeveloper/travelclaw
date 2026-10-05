/**
 * The derived FTS5 index over `memory_notes` (issue #6).
 *
 * `memory_notes` is the only copy of a note. The index is a shadow of it, kept in
 * step by three triggers and rebuilt when it drifts, so a search can never show a
 * note that is gone or hide one that is there. It is created outside `SCHEMA` on
 * purpose: a SQLite built without FTS5 must not stop the gateway from starting.
 * `ensureMemoryFts` probes, reports why it declined, and memory search falls back
 * to a `LIKE` scan over the table instead.
 *
 * Reconciliation follows OpenClaw's `memory-schema-fts.ts`: the persisted DDL is
 * read back and compared, because `CREATE VIRTUAL TABLE IF NOT EXISTS` silently
 * keeps whatever tokenizer an older version chose, and a name that belongs to an
 * ordinary table is never dropped.
 */

export const MEMORY_FTS_TABLE = 'memory_notes_fts';

/**
 * `remove_diacritics 2` folds accents on both sides, so "hôtel" is found by
 * "hotel". Case folding is unicode61's default.
 */
export const MEMORY_FTS_TOKENIZE = "tokenize='unicode61 remove_diacritics 2'";

/** Indexed columns first: `bm25()` weights are positional. */
export const MEMORY_FTS_COLUMNS = ['title', 'body', 'note_id', 'kind', 'agent_id'] as const;

export const MEMORY_FTS_DDL = `CREATE VIRTUAL TABLE IF NOT EXISTS ${MEMORY_FTS_TABLE} USING fts5(
  title,
  body,
  note_id UNINDEXED,
  kind UNINDEXED,
  agent_id UNINDEXED,
  ${MEMORY_FTS_TOKENIZE}
)`;

/**
 * The index follows the table. `AFTER UPDATE OF` lists every column the index
 * stores, so an update that touches none of them does not rewrite the index.
 */
export const MEMORY_FTS_TRIGGERS = [
  {
    name: 'memory_notes_fts_after_insert',
    sql: `CREATE TRIGGER IF NOT EXISTS main.memory_notes_fts_after_insert
      AFTER INSERT ON memory_notes
      BEGIN
        INSERT INTO ${MEMORY_FTS_TABLE} (title, body, note_id, kind, agent_id)
        VALUES (NEW.title, NEW.body, NEW.id, NEW.kind, NEW.agent_id);
      END`,
  },
  {
    name: 'memory_notes_fts_after_update',
    sql: `CREATE TRIGGER IF NOT EXISTS main.memory_notes_fts_after_update
      AFTER UPDATE OF title, body, kind, agent_id ON memory_notes
      BEGIN
        DELETE FROM ${MEMORY_FTS_TABLE} WHERE note_id = OLD.id;
        INSERT INTO ${MEMORY_FTS_TABLE} (title, body, note_id, kind, agent_id)
        VALUES (NEW.title, NEW.body, NEW.id, NEW.kind, NEW.agent_id);
      END`,
  },
  {
    name: 'memory_notes_fts_after_delete',
    sql: `CREATE TRIGGER IF NOT EXISTS main.memory_notes_fts_after_delete
      AFTER DELETE ON memory_notes
      BEGIN
        DELETE FROM ${MEMORY_FTS_TABLE} WHERE note_id = OLD.id;
      END`,
  },
] as const;

/** The statements this module needs; `DatabaseService` satisfies it. */
export interface SqlExecutor {
  exec(sql: string): void;
  all<T>(sql: string, ...params: (string | number)[]): T[];
  get<T>(sql: string, ...params: (string | number)[]): T | undefined;
  transaction<T>(fn: () => T): T;
}

export interface MemoryFtsStatus {
  /** False means memory search runs on the `LIKE` scan instead. */
  available: boolean;
  /** True when this boot rebuilt the index rather than trusting it. */
  rebuilt: boolean;
  reason?: string;
}

/**
 * Create the index when it is missing, rebuild it when the persisted definition or
 * its contents no longer match the notes, and never fail the boot: memory search
 * degrades to a scan instead of taking the gateway down.
 */
export function ensureMemoryFts(db: SqlExecutor): MemoryFtsStatus {
  try {
    if (!fts5Available(db)) {
      return { available: false, rebuilt: false, reason: 'this SQLite build has no FTS5' };
    }
    const state = ftsTableState(db);
    if (state === 'collides') {
      // Failing closed is the point: an ordinary table with this name holds
      // somebody's data, and it is not ours to drop.
      return {
        available: false,
        rebuilt: false,
        reason: `${MEMORY_FTS_TABLE} is not an FTS5 table; leaving it alone`,
      };
    }
    return db.transaction(() => {
      const replaced = state === 'mismatched';
      if (replaced) db.exec(`DROP TABLE ${MEMORY_FTS_TABLE}`);
      db.exec(MEMORY_FTS_DDL);
      // Measured before the triggers are installed: a fresh index has none yet,
      // and a stripped one must not be made to look maintained first.
      const unmaintained = triggersMissing(db);
      const outOfStep = countsDiffer(db);
      for (const trigger of MEMORY_FTS_TRIGGERS) db.exec(trigger.sql);
      // Re-copy the notes whenever the index cannot be shown to agree with the
      // table: it was just replaced (so it is empty), it is missing rows, or —
      // for an index that already existed — nothing was maintaining it. A brand
      // new index over an empty table has nothing to rebuild, and says so.
      const rebuilt = replaced || outOfStep || (state !== 'missing' && unmaintained);
      if (rebuilt) rebuildMemoryFts(db);
      return { available: true, rebuilt };
    });
  } catch (error) {
    return {
      available: false,
      rebuilt: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Drop the derived index and its triggers. Notes themselves are untouched. */
export function dropMemoryFts(db: SqlExecutor): void {
  for (const trigger of MEMORY_FTS_TRIGGERS)
    db.exec(`DROP TRIGGER IF EXISTS main.${trigger.name}`);
  if (ftsTableState(db) !== 'collides') db.exec(`DROP TABLE IF EXISTS ${MEMORY_FTS_TABLE}`);
}

/** Re-copy every note into the index. */
export function rebuildMemoryFts(db: SqlExecutor): void {
  db.exec(`DELETE FROM ${MEMORY_FTS_TABLE}`);
  db.exec(
    `INSERT INTO ${MEMORY_FTS_TABLE} (title, body, note_id, kind, agent_id)
     SELECT title, body, id, kind, agent_id FROM memory_notes`,
  );
}

/** The only reliable probe is to build one: FTS5 is a compile-time option. */
function fts5Available(db: SqlExecutor): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE temp.travelclaw_fts_probe USING fts5(body)');
    db.exec('DROP TABLE temp.travelclaw_fts_probe');
    return true;
  } catch {
    return false;
  }
}

type FtsTableState = 'missing' | 'matching' | 'mismatched' | 'collides';

function ftsTableState(db: SqlExecutor): FtsTableState {
  const row = db.get<{ type?: unknown; sql?: unknown }>(
    "SELECT type, sql FROM sqlite_master WHERE name = ? COLLATE NOCASE AND type IN ('table', 'view')",
    MEMORY_FTS_TABLE,
  );
  if (!row) return 'missing';
  if (typeof row.sql !== 'string' || !isFtsDeclaration(row.sql)) return 'collides';
  const columns = db
    .all<{ name?: unknown }>(
      'SELECT name FROM pragma_table_info(?) ORDER BY cid',
      MEMORY_FTS_TABLE,
    )
    .map((column) => column.name);
  const matches =
    columns.length === MEMORY_FTS_COLUMNS.length &&
    columns.every((column, index) => column === MEMORY_FTS_COLUMNS[index]) &&
    ftsOptions(row.sql) === ftsOptions(MEMORY_FTS_DDL);
  return matches ? 'matching' : 'mismatched';
}

function isFtsDeclaration(sql: string): boolean {
  const normalized = compact(sql);
  return normalized.startsWith('createvirtualtable') && normalized.includes('usingfts5(');
}

/** The tokenizer clause, compared without whitespace or quoting differences. */
function ftsOptions(sql: string): string {
  const normalized = compact(sql);
  const start = normalized.indexOf('usingfts5(');
  return start === -1 ? '' : normalized.slice(start).replaceAll("'", '');
}

function compact(sql: string): string {
  return sql.replace(/[\s']/g, '').toLowerCase();
}

function triggersMissing(db: SqlExecutor): boolean {
  return MEMORY_FTS_TRIGGERS.some(
    (trigger) =>
      !db.get(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        trigger.name,
      ),
  );
}

function countsDiffer(db: SqlExecutor): boolean {
  const counts = db.get<{ notes?: unknown; indexed?: unknown }>(
    `SELECT
       (SELECT COUNT(*) FROM memory_notes) AS notes,
       (SELECT COUNT(*) FROM ${MEMORY_FTS_TABLE}) AS indexed`,
  );
  return Number(counts?.notes ?? 0) !== Number(counts?.indexed ?? 0);
}
