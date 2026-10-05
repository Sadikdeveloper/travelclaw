import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from '../src/db/database.service';
import {
  ensureMemoryFts,
  MEMORY_FTS_TABLE,
  MEMORY_FTS_TRIGGERS,
} from '../src/db/memory-search-schema';
import {
  bm25RankToScore,
  BODY_WEIGHT,
  buildMatchQuery,
  compareScoredNotes,
  coverageRelevance,
  escapeLike,
  hasUnsegmentedRun,
  MAX_QUERY_TERMS,
  RECENCY_FLOOR,
  recencyFactor,
  searchTerms,
  TITLE_WEIGHT,
} from '../src/memory/fts';

/**
 * The query builder is the edge of the search that faces traveler text, so it gets
 * its own tests: every one of these inputs makes FTS5 throw when it reaches the
 * parser unquoted.
 */
describe('memory search query building', () => {
  it('keeps letters and digits and drops everything FTS5 would parse', () => {
    expect(searchTerms('Window seats, please! (aisle NOT ok)')).toEqual([
      'window',
      'seats',
      'please',
      'aisle',
      'not',
      'ok',
    ]);
  });

  it('de-duplicates so one repeated word cannot outweigh two different ones', () => {
    expect(searchTerms('trains trains TRAINS taxis')).toEqual(['trains', 'taxis']);
  });

  it('caps a whole paragraph of terms', () => {
    expect(searchTerms(Array(60).fill('seat').join(' '))).toHaveLength(1);
    expect(
      searchTerms(Array.from({ length: 60 }, (_, i) => `term${i}`).join(' ')),
    ).toHaveLength(MAX_QUERY_TERMS);
  });

  it('finds nothing to search for in punctuation, so no MATCH is built', () => {
    for (const query of ['', '   ', '???', '"*"', '— – …']) {
      expect(searchTerms(query)).toEqual([]);
      expect(buildMatchQuery(searchTerms(query), 'AND')).toBeNull();
    }
  });

  it('treats operator words as words, which quoting makes safe to send', () => {
    // Bare, this is an FTS5 syntax error; quoted, it asks for notes saying "and".
    expect(buildMatchQuery(searchTerms('AND OR NOT'), 'AND')).toBe(
      '"and" AND "or" AND "not"',
    );
    expect(buildMatchQuery(searchTerms('NEAR/3 (foo) bar*'), 'OR')).toBe(
      '"near" OR "3" OR "foo" OR "bar"',
    );
  });

  it('quotes each term, so FTS5 syntax in the query stays data', () => {
    expect(buildMatchQuery(['window', 'seat'], 'AND')).toBe('"window" AND "seat"');
    expect(buildMatchQuery(['window', 'seat'], 'OR')).toBe('"window" OR "seat"');
    // A caller handing over raw text still cannot open a phrase or a prefix.
    expect(buildMatchQuery(['a"b', 'c*'], 'AND')).toBe('"ab" AND "c*"');
  });

  it('routes a script the tokenizer cannot segment to the scan', () => {
    expect(hasUnsegmentedRun('数据库迁移')).toBe(true);
    expect(hasUnsegmentedRun('東京の乗り換え')).toBe(true);
    expect(hasUnsegmentedRun('서울역')).toBe(true);
    expect(hasUnsegmentedRun('window seats')).toBe(false);
    expect(hasUnsegmentedRun('café au lait')).toBe(false);
  });

  it('escapes the LIKE wildcards a traveler can type', () => {
    expect(escapeLike('50_percent')).toBe('50\\_percent');
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    expect(escapeLike('plain')).toBe('plain');
  });

  it('folds a bm25 rank into 0..1, better match higher', () => {
    expect(bm25RankToScore(-4)).toBeCloseTo(0.8);
    expect(bm25RankToScore(-1)).toBeCloseTo(0.5);
    expect(bm25RankToScore(-4)).toBeGreaterThan(bm25RankToScore(-0.2));
    // A rank that is not a better-than-nothing match scores nothing at all.
    expect(bm25RankToScore(0)).toBe(0);
    expect(bm25RankToScore(Number.NaN)).toBe(0);
  });

  it('decays with age but never to zero, and treats clock skew as today', () => {
    const now = new Date('2026-10-04T00:00:00.000Z');
    const daysAgo = (days: number) =>
      new Date(now.getTime() - days * 86_400_000).toISOString();
    expect(recencyFactor(daysAgo(0), now)).toBeCloseTo(1);
    expect(recencyFactor(daysAgo(90), now)).toBeCloseTo(0.8); // one half-life
    expect(recencyFactor(daysAgo(3650), now)).toBeGreaterThan(RECENCY_FLOOR);
    expect(recencyFactor(daysAgo(-30), now)).toBeCloseTo(1); // dated in the future
    expect(recencyFactor('not a date', now)).toBe(RECENCY_FLOOR);
  });

  it('scores term coverage on the same title/body weighting', () => {
    const note = {
      id: 'n1',
      title: 'Window seat',
      body: 'Always books a window seat on long flights',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const inTitleAndBody = coverageRelevance(note, ['window']);
    const inBodyOnly = coverageRelevance(note, ['flights']);
    expect(inTitleAndBody).toBe(1);
    expect(inBodyOnly).toBeCloseTo(BODY_WEIGHT / (TITLE_WEIGHT + BODY_WEIGHT));
    // Answering part of a two-part question scores between the two, and a note
    // covering both terms beats one covering a single term.
    expect(coverageRelevance(note, ['window', 'flights'])).toBeGreaterThan(inBodyOnly);
    expect(
      coverageRelevance(
        {
          ...note,
          id: 'n2',
          title: 'Window seats on long flights',
          body: 'window and flights',
        },
        ['window', 'flights'],
      ),
    ).toBeGreaterThan(coverageRelevance(note, ['window', 'flights']));
    expect(coverageRelevance(note, ['nothing'])).toBe(0);
    expect(coverageRelevance(note, [])).toBe(0);
  });

  it('orders equal scores by a fixed key, so one query has one order', () => {
    const at = (id: string, title: string, score: number) => ({
      note: { id, title, body: 'body', createdAt: '2026-01-01T00:00:00.000Z' },
      relevance: score,
      score,
    });
    const ranked = [at('b', 'Same', 0.5), at('a', 'Same', 0.5), at('c', 'Ahead', 0.9)].sort(
      compareScoredNotes,
    );
    expect(ranked.map((row) => row.note.id)).toEqual(['c', 'a', 'b']);
  });
});

/** Boot the database on its own, the way `db-migration.test.ts` does. */
function openDatabase(dir: string) {
  const databasePath = join(dir, 'memory.db');
  process.env.DATABASE_PATH = databasePath;
  const service = new DatabaseService();
  service.onModuleInit();
  return { service, databasePath };
}

function note(service: DatabaseService, id: string, body: string, agent = 'marlow') {
  service.run(
    `INSERT INTO memory_notes (id, agent_id, kind, title, body, note_date, created_at)
     VALUES (?, ?, 'fact', ?, ?, NULL, ?)`,
    id,
    agent,
    body.slice(0, 40),
    body,
    '2026-10-01T00:00:00.000Z',
  );
}

describe('memory search index lifecycle', () => {
  const previousPath = process.env.DATABASE_PATH;

  afterEach(() => {
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
  });

  it('is available on this SQLite and follows the table on every write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-fts-'));
    const { service } = openDatabase(dir);
    try {
      expect(service.hasMemoryFts()).toBe(true);

      note(service, 'n1', 'Prefers a window seat');
      expect(service.all(`SELECT note_id FROM ${MEMORY_FTS_TABLE}`)).toEqual([
        expect.objectContaining({ note_id: 'n1' }),
      ]);

      service.run(
        'UPDATE memory_notes SET body = ? WHERE id = ?',
        'Prefers the aisle',
        'n1',
      );
      const rows = service.all<{ body: string }>(
        `SELECT body FROM ${MEMORY_FTS_TABLE} WHERE note_id = 'n1'`,
      );
      expect(rows).toEqual([{ body: 'Prefers the aisle' }]);

      service.run('DELETE FROM memory_notes WHERE id = ?', 'n1');
      expect(service.all(`SELECT note_id FROM ${MEMORY_FTS_TABLE}`)).toHaveLength(0);
    } finally {
      service.onModuleDestroy();
    }
  });

  it('indexes the notes an install already had before the index existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-fts-backfill-'));
    const databasePath = join(dir, 'memory.db');
    // An install from before search: notes, no index.
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE memory_notes (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, body TEXT NOT NULL, note_date TEXT, created_at TEXT NOT NULL
      );
      INSERT INTO memory_notes VALUES
        ('old', 'marlow', 'fact', 'Old note', 'Collected boarding passes', NULL, '2025-01-01');
    `);
    legacy.close();

    process.env.DATABASE_PATH = databasePath;
    const service = new DatabaseService();
    service.onModuleInit();
    try {
      expect(service.hasMemoryFts()).toBe(true);
      expect(service.all(`SELECT note_id FROM ${MEMORY_FTS_TABLE}`)).toEqual([
        expect.objectContaining({ note_id: 'old' }),
      ]);
      // Now that it agrees with the table, the next boot has nothing to report.
      expect(ensureMemoryFts(service)).toEqual({ available: true, rebuilt: false });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('rebuilds an index that drifted from the table instead of trusting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-fts-drift-'));
    const databasePath = join(dir, 'memory.db');
    process.env.DATABASE_PATH = databasePath;

    const first = new DatabaseService();
    first.onModuleInit();
    note(first, 'n1', 'Prefers a window seat');
    note(first, 'n2', 'Prefers trains to taxis');
    // Drift: an index row for a note that is gone, and a note that was never indexed.
    first.run('DELETE FROM memory_notes WHERE id = ?', 'n1');
    first.run(`DELETE FROM ${MEMORY_FTS_TABLE} WHERE note_id = ?`, 'n2');
    first.onModuleDestroy();

    const second = new DatabaseService();
    second.onModuleInit();
    try {
      expect(second.all(`SELECT note_id FROM ${MEMORY_FTS_TABLE}`)).toEqual([
        expect.objectContaining({ note_id: 'n2' }),
      ]);
    } finally {
      second.onModuleDestroy();
    }
  });

  it('rebuilds when the persisted tokenizer is not the one this build expects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-fts-tokenizer-'));
    const databasePath = join(dir, 'memory.db');
    // An index an older version left behind: same name, different tokenizer.
    // `CREATE VIRTUAL TABLE IF NOT EXISTS` would silently keep it.
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      `CREATE VIRTUAL TABLE ${MEMORY_FTS_TABLE} USING fts5(
         title, body, note_id UNINDEXED, kind UNINDEXED, agent_id UNINDEXED,
         tokenize='trigram')`,
    );
    legacy.close();

    process.env.DATABASE_PATH = databasePath;
    const service = new DatabaseService();
    service.onModuleInit();
    try {
      const definition = service.get<{ sql: string }>(
        'SELECT sql FROM sqlite_master WHERE name = ?',
        MEMORY_FTS_TABLE,
      );
      expect(definition?.sql).toMatch(/remove_diacritics 2/);
      expect(definition?.sql).not.toMatch(/trigram/);
      // And the recreated index actually serves a search.
      note(service, 'n1', 'Prefers a window seat');
      expect(
        service.all(
          `SELECT note_id FROM ${MEMORY_FTS_TABLE} WHERE ${MEMORY_FTS_TABLE} MATCH '"window"'`,
        ),
      ).toHaveLength(1);
    } finally {
      service.onModuleDestroy();
    }
  });

  it('leaves an ordinary table alone when something else owns the index name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-fts-collide-'));
    const databasePath = join(dir, 'memory.db');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      `CREATE TABLE ${MEMORY_FTS_TABLE} (id TEXT PRIMARY KEY, kept TEXT);
       INSERT INTO ${MEMORY_FTS_TABLE} VALUES ('x', 'not ours to drop');`,
    );
    legacy.close();

    process.env.DATABASE_PATH = databasePath;
    const service = new DatabaseService();
    service.onModuleInit();
    try {
      expect(service.hasMemoryFts()).toBe(false);
      expect(service.get(`SELECT kept FROM ${MEMORY_FTS_TABLE} WHERE id = 'x'`)).toEqual({
        kept: 'not ours to drop',
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('reinstalls a trigger somebody dropped, and re-copies the notes with it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-fts-trigger-'));
    const databasePath = join(dir, 'memory.db');
    process.env.DATABASE_PATH = databasePath;

    const first = new DatabaseService();
    first.onModuleInit();
    note(first, 'n1', 'Prefers a window seat');
    first.exec(`DROP TRIGGER main.${MEMORY_FTS_TRIGGERS[0].name}`);
    first.onModuleDestroy();

    const second = new DatabaseService();
    second.onModuleInit();
    try {
      const triggers = second
        .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")
        .map((row) => row.name);
      for (const trigger of MEMORY_FTS_TRIGGERS) expect(triggers).toContain(trigger.name);
      expect(second.all(`SELECT note_id FROM ${MEMORY_FTS_TABLE}`)).toHaveLength(1);
    } finally {
      second.onModuleDestroy();
    }
  });
});
