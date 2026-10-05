import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MEMORY_MAX_BYTES, MEMORY_MAX_LINES } from '@travelclaw/agent-core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DatabaseService } from '../src/db/database.service';
import { MemoryService } from '../src/memory/memory.service';

/**
 * SQLite FTS memory search (issue #6): an old note is findable, ranking is stable,
 * a forgotten note stays gone, and `MEMORY.md` remains the human-readable copy that
 * still round-trips through the importer.
 */
describe('memory search', () => {
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-memory-'));
  const root = join(dir, 'workspace');
  const encoder = new TextEncoder();
  let app: INestApplication;

  const env = () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = root;
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'mock';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;
  };

  /** A gateway over the same database and workspace, i.e. the next start. */
  async function restart(): Promise<INestApplication> {
    env();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const next = moduleRef.createNestApplication();
    configureApp(next);
    await next.init();
    return next;
  }

  beforeAll(async () => {
    app = await restart();
  });

  afterAll(async () => {
    await app.close();
  });

  async function save(
    body: string,
    options: { kind?: string; title?: string; agentId?: string } = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/memory')
      .send({
        body,
        kind: options.kind ?? 'preference',
        title: options.title,
        agentId: options.agentId,
      });
    expect(res.status).toBe(201);
    return res.body as { id: string; body: string; title: string };
  }

  /** Backdate a note, the way an install that has run for a year would have it. */
  function backdate(id: string, isoDate: string) {
    app
      .get(DatabaseService)
      .run('UPDATE memory_notes SET created_at = ? WHERE id = ?', isoDate, id);
  }

  async function search(query: string, params: Record<string, string> = {}) {
    const res = await request(app.getHttpServer())
      .get('/api/memory')
      .query({ q: query, ...params });
    expect(res.status).toBe(200);
    return res.body as {
      id: string;
      body: string;
      title: string;
      kind: string;
      score: number;
    }[];
  }

  it('finds a note that fell out of the recent list', async () => {
    const old = await save('Traveler collects vintage boarding passes', { kind: 'fact' });
    backdate(old.id, '2024-03-01T09:00:00.000Z');
    // Enough newer notes that the old one is no longer in the last twelve.
    for (let index = 0; index < 15; index += 1) {
      await save(`Recent note number ${index} about ordinary planning`);
    }

    const memory = app.get(MemoryService);
    expect(memory.promptLines('marlow').join('\n')).not.toContain(
      'vintage boarding passes',
    );
    expect(
      memory.promptLines('marlow', 'where are my vintage boarding passes?').join('\n'),
    ).toContain('vintage boarding passes');

    const hits = await search('vintage boarding passes');
    expect(hits[0]?.id).toBe(old.id);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('ranks a title match above a body-only match, and the same query the same way', async () => {
    // The same instant and the same shape, so the only thing that differs is the
    // field the word appears in: the body-match note even has the shorter body.
    const titled = await save('Books the middle when the flight is a short one', {
      title: 'Aisle seat rule',
    });
    const buried = await save('Aisle every time on a short hop flight', { title: 'Short' });
    backdate(titled.id, '2026-09-30T09:00:00.000Z');
    backdate(buried.id, '2026-09-30T09:00:00.000Z');

    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => search('aisle')));
    const orders = runs.map((run) => run.map((hit) => hit.id).join(','));
    expect(new Set(orders).size).toBe(1);
    const ids = orders[0].split(',');
    expect(ids).toContain(buried.id);
    expect(ids.indexOf(titled.id)).toBeLessThan(ids.indexOf(buried.id));
  });

  it('keeps a stable order for two notes that score exactly alike', async () => {
    const second = await save('Seat 12B on the Lagos run');
    const first = await save('Seat 12A on the Lagos run');
    backdate(second.id, '2026-09-15T09:00:00.000Z');
    backdate(first.id, '2026-09-15T09:00:00.000Z');

    const runs = await Promise.all([1, 2, 3].map(() => search('Seat on the Lagos run')));
    const orders = runs.map((run) => run.map((hit) => hit.id).join(','));
    expect(new Set(orders).size).toBe(1);
    // Same score, so the fixed tie-break decides: title, then id.
    const tied = runs[0].filter((hit) => hit.body.includes('Seat 12'));
    expect(tied.map((hit) => hit.title).sort()).toEqual(tied.map((hit) => hit.title));
  });

  it('prefers the newer of two notes that match the same way', async () => {
    // Same body shape, so BM25 ties, and titles that put the tie-break on the
    // older note: only recency can bring the newer one above it.
    const older = await save('Prefers aisle seats on a redeye flight', {
      title: 'Alpha note',
    });
    const newer = await save('Prefers aisle seats on a daytime flight', {
      title: 'Zulu note',
    });
    backdate(older.id, '2024-01-01T09:00:00.000Z');
    backdate(newer.id, new Date().toISOString());

    const hits = await search('aisle seats flight');
    const ids = hits.map((hit) => hit.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    // Recency modulates; it does not bury an old note that is the better match.
    expect(ids).toContain(older.id);
  });

  it('answers a question that shares only some words with the note', async () => {
    const note = await save(
      'Sarah likes the standup scheduled early on Thursday mornings',
      {
        kind: 'fact',
      },
    );
    backdate(note.id, '2026-08-01T09:00:00.000Z');

    // FTS5 ANDs its terms, so the strict match is empty; the OR retry finds it.
    const hits = await search('when does Sarah like her standup');
    expect(hits.map((hit) => hit.id)).toContain(note.id);
  });

  it('keeps a kind filter and one agent to its own notes', async () => {
    await save('Beta keeps a window seat preference', { agentId: undefined });
    const created = await request(app.getHttpServer()).post('/api/agents').send({
      name: 'Gamma',
      role: 'Visa desk',
      description: 'Checks entry notes.',
    });
    expect(created.status).toBe(201);
    const other = await save('Gamma keeps a passport fact', {
      kind: 'fact',
      agentId: created.body.id,
    });

    expect(
      (await search('passport', { agentId: created.body.id })).map((hit) => hit.id),
    ).toEqual([other.id]);
    expect(await search('passport')).toEqual([]);

    const preference = await save('Window over aisle, every time', { kind: 'preference' });
    await save('Decided the window question once', { kind: 'decision' });
    const facts = await search('window', { kind: 'preference' });
    expect(facts.map((hit) => hit.id)).toContain(preference.id);
    expect(facts.every((hit) => hit.kind === 'preference')).toBe(true);
  });

  it('treats a query of FTS5 operators as text instead of failing', async () => {
    const note = await save('Prefers trains to taxis in every city');
    for (const query of [
      '"trains" AND (taxis OR cars) NOT ^ NEAR/3 buses',
      'trains* : {taxis} - buses',
      '*',
      '""""',
      'AND OR NOT NEAR',
    ]) {
      const res = await request(app.getHttpServer()).get('/api/memory').query({ q: query });
      expect(res.status).toBe(200);
    }
    expect(
      (await search('"trains" AND (taxis OR cars) NOT ^ NEAR/3 buses')).map((h) => h.id),
    ).toContain(note.id);
    // Nothing to search for returns nothing, rather than every note the desk has.
    expect(await search('???')).toEqual([]);
  });

  it('finds a note written in a script the tokenizer cannot segment', async () => {
    const note = await save('我们讨论过数据库迁移计划', { kind: 'fact' });
    const hits = await search('数据库迁移');
    expect(hits.map((hit) => hit.id)).toContain(note.id);
  });

  it('escapes the LIKE wildcards on the scan path', async () => {
    const literal = await save('东京 50_percent 折扣');
    const lookalike = await save('东京 50Xpercent 折扣');
    // Unescaped, `50_percent` would match the lookalike too and the two would tie.
    const hits = await search('东京 50_percent');
    const ids = hits.map((hit) => hit.id);
    expect(ids.indexOf(literal.id)).toBeLessThan(ids.indexOf(lookalike.id));
  });

  it('keeps a forgotten note out of results, and out of the next boot', async () => {
    const note = await save('Traveler hates windowless hotel rooms', { kind: 'fact' });
    expect((await search('windowless')).map((hit) => hit.id)).toEqual([note.id]);
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toContain(
      'windowless hotel rooms',
    );

    const removed = await request(app.getHttpServer()).delete(`/api/memory/${note.id}`);
    expect(removed.status).toBe(204);
    expect(await search('windowless')).toEqual([]);
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).not.toContain(
      'windowless hotel rooms',
    );

    // The file is imported on boot, so a bullet left behind would resurrect it.
    const again = await restart();
    try {
      const res = await request(again.getHttpServer())
        .get('/api/memory')
        .query({ q: 'windowless' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    } finally {
      await again.close();
    }

    const missing = await request(app.getHttpServer()).delete(`/api/memory/${note.id}`);
    expect(missing.status).toBe(404);
  });

  it('round-trips MEMORY.md without importing a note twice', async () => {
    const remembered = await save('Always books the earlier of two flights');
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toContain(
      `- [preference] Always books the earlier of two flights`,
    );

    // An operator edits the human-readable copy; the next start picks it up.
    writeFileSync(
      join(root, 'MEMORY.md'),
      `${readFileSync(join(root, 'MEMORY.md'), 'utf8').trimEnd()}\n- [decision] Chose Alfama over Baixa for the Lisbon stay (2026-02-11)\n`,
    );
    const next = await restart();
    try {
      const hits = await request(next.getHttpServer())
        .get('/api/memory')
        .query({ q: 'Alfama or Baixa' });
      expect(hits.status).toBe(200);
      expect(hits.body[0]).toMatchObject({
        kind: 'decision',
        noteDate: '2026-02-11',
      });
    } finally {
      await next.close();
    }

    // Importing again adds nothing, and the note remembered from chat is still there.
    const again = await restart();
    try {
      const memory = again.get(MemoryService);
      memory.onModuleInit();
      const rows = again
        .get(DatabaseService)
        .all<{ body: string }>(
          'SELECT body FROM memory_notes WHERE agent_id = ?',
          'marlow',
        );
      const bodies = rows.map((row) => row.body);
      expect(bodies.filter((body) => body.includes('Alfama over Baixa'))).toHaveLength(1);
      expect(bodies).toContain(remembered.body);
      expect(
        memory.search('marlow', 'earlier of two flights').map((hit) => hit.id),
      ).toEqual([remembered.id]);
    } finally {
      await again.close();
    }
  });

  it('keeps the prompt inside the budget it had when memory was the last twelve', async () => {
    const long = 'A'.repeat(900);
    for (let index = 0; index < 4; index += 1) await save(`${long} note ${index}`);

    const lines = app.get(MemoryService).promptLines('marlow', 'note');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(MEMORY_MAX_LINES);
    const bytes = lines.reduce((total, line) => total + encoder.encode(line).length + 1, 0);
    expect(bytes).toBeLessThanOrEqual(MEMORY_MAX_BYTES);
    expect(app.get(MemoryService).promptLines('marlow').length).toBeLessThanOrEqual(
      MEMORY_MAX_LINES,
    );
  });

  it('lists when there is no question, and rejects a bad filter', async () => {
    const blank = await request(app.getHttpServer()).get('/api/memory').query({ q: '   ' });
    expect(blank.status).toBe(200);
    expect(Array.isArray(blank.body)).toBe(true);
    expect(blank.body.length).toBeGreaterThan(0);
    expect(blank.body[0].score).toBeUndefined();

    const bad = await request(app.getHttpServer())
      .get('/api/memory')
      .query({ q: 'seat', kind: 'opinion' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');

    const tooMany = await request(app.getHttpServer())
      .get('/api/memory')
      .query({ q: 'seat', limit: '500' });
    expect(tooMany.status).toBe(400);
  });
});

/**
 * Search has to survive a SQLite with no FTS5, which is why the scan exists. The
 * index name being taken by an ordinary table is the same branch: the gateway
 * starts, search degrades, and the table that is not ours is left alone.
 */
describe('memory search without an FTS5 index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-memory-scan-'));
  let app: INestApplication;

  beforeAll(async () => {
    const databasePath = join(dir, 'test.db');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      `CREATE TABLE memory_notes_fts (id TEXT PRIMARY KEY, kept TEXT);
       INSERT INTO memory_notes_fts VALUES ('x', 'not ours to drop');`,
    );
    legacy.close();

    process.env.DATABASE_PATH = databasePath;
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'mock';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function save(body: string, kind = 'preference') {
    const res = await request(app.getHttpServer()).post('/api/memory').send({ body, kind });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  async function search(query: string) {
    const res = await request(app.getHttpServer()).get('/api/memory').query({ q: query });
    expect(res.status).toBe(200);
    return res.body as { id: string; body: string }[];
  }

  it('answers by scanning the notes instead of failing to start', async () => {
    expect(app.get(DatabaseService).hasMemoryFts()).toBe(false);
    expect(
      app
        .get(DatabaseService)
        .get<{ kept: string }>('SELECT kept FROM memory_notes_fts WHERE id = ?', 'x'),
    ).toEqual({ kept: 'not ours to drop' });

    const old = await save('Traveler collects vintage boarding passes', 'fact');
    app
      .get(DatabaseService)
      .run(
        'UPDATE memory_notes SET created_at = ? WHERE id = ?',
        '2024-03-01T09:00:00.000Z',
        old.id,
      );
    for (let index = 0; index < 14; index += 1)
      await save(`Ordinary planning note ${index}`);

    expect((await search('vintage boarding passes')).map((hit) => hit.id)).toEqual([
      old.id,
    ]);
    expect(
      app.get(MemoryService).promptLines('marlow', 'vintage boarding passes').join('\n'),
    ).toContain('vintage boarding passes');
  });

  it('escapes a literal underscore, which an unescaped LIKE would read as a wildcard', async () => {
    const literal = await save('Chases 50_percent deals only');
    const lookalike = await save('Chases 50Xpercent deals only');
    expect((await search('50_percent')).map((hit) => hit.id)).toEqual([literal.id]);
    expect((await search('50Xpercent')).map((hit) => hit.id)).toEqual([lookalike.id]);
  });

  it('takes FTS5 operators as text and finds a script the tokenizer cannot segment', async () => {
    const note = await save('我们讨论过数据库迁移计划', 'fact');
    for (const query of ['"数据库" AND (迁移 OR *) NOT ^', '???']) {
      const res = await request(app.getHttpServer()).get('/api/memory').query({ q: query });
      expect(res.status).toBe(200);
    }
    expect((await search('数据库迁移')).map((hit) => hit.id)).toEqual([note.id]);
  });
});
