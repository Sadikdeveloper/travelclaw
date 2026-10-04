import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { WorkspaceService } from '../src/workspace/workspace.service';

/**
 * Per-agent workspace (issue #7): workspace/agents/<id>/<file> overrides the shared
 * desk file when it exists, absence falls back to the shared one per file, agent ids
 * cannot climb out of the workspace, and the API says which file backs each slot.
 */
describe('per-agent workspace (workspace/agents/<id>/)', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-workspace-'));
  const root = join(dir, 'workspace');

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = root;
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

  it('falls back to the shared files when no override exists', async () => {
    const shared = await request(app.getHttpServer()).get('/api/workspace');
    expect(shared.status).toBe(200);
    expect(shared.body.sources).toEqual({
      soul: { source: 'shared', path: 'SOUL.md' },
      identity: { source: 'shared', path: 'IDENTITY.md' },
      user: { source: 'shared', path: 'USER.md' },
      agents: { source: 'shared', path: 'AGENTS.md' },
      memory: { source: 'shared', path: 'MEMORY.md' },
    });

    // The default agent with no files added keeps today's behavior exactly.
    const def = await request(app.getHttpServer()).get('/api/workspace?agentId=marlow');
    expect(def.status).toBe(200);
    expect(def.body.soul).toBe(shared.body.soul);
    expect(def.body.identity).toBe(shared.body.identity);
    expect(def.body.sources.soul).toEqual({ source: 'shared', path: 'SOUL.md' });
  });

  it('imports the shared MEMORY.md for the default agent at boot', async () => {
    const res = await request(app.getHttpServer()).get('/api/memory');
    expect(res.status).toBe(200);
    expect(
      res.body.some((note: { body: string }) => /walkable neighborhoods/i.test(note.body)),
    ).toBe(true);
  });

  it('overrides only the files the agent folder actually has', async () => {
    mkdirSync(join(root, 'agents', 'alpha'), { recursive: true });
    writeFileSync(join(root, 'agents', 'alpha', 'SOUL.md'), '# Soul\n\nAlpha is terse.\n');

    const shared = await request(app.getHttpServer()).get('/api/workspace');
    const alpha = await request(app.getHttpServer()).get('/api/workspace?agentId=alpha');
    expect(alpha.status).toBe(200);
    expect(alpha.body.soul).toContain('Alpha is terse.');
    expect(alpha.body.sources.soul).toEqual({
      source: 'agent',
      path: 'agents/alpha/SOUL.md',
    });

    // Per file, not all-or-nothing: every other slot still reads the shared desk file.
    expect(alpha.body.sources.identity).toEqual({ source: 'shared', path: 'IDENTITY.md' });
    expect(alpha.body.identity).toBe(shared.body.identity);
    expect(alpha.body.user).toBe(shared.body.user);
    expect(alpha.body.agents).toBe(shared.body.agents);
    expect(alpha.body.memory).toBe(shared.body.memory);
  });

  it('refuses an agent id that climbs out of the workspace', async () => {
    const workspace = app.get(WorkspaceService);
    for (const id of ['../../etc', '..', 'foo/bar', 'foo\\bar', 'marlow/../../..']) {
      expect(() => workspace.read('SOUL.md', id)).toThrow(BadRequestException);
    }
    // The id is refused before any path is built from it, so nothing escapes.
    expect(() => workspace.read('SOUL.md', '../../etc')).toThrow('not a workspace folder');

    const traversal = await request(app.getHttpServer())
      .get('/api/workspace')
      .query({ agentId: '../../etc/passwd' });
    expect(traversal.status).toBe(400);
    expect(traversal.body.error.message).toMatch(/not a workspace folder/);

    const encoded = await request(app.getHttpServer()).get(
      '/api/workspace?agentId=%2e%2e%2f%2e%2e',
    );
    expect(encoded.status).toBe(400);
  });

  it('appends remembered lines to the agent override when one exists', async () => {
    const created = await request(app.getHttpServer()).post('/api/agents').send({
      name: 'Beta',
      role: 'Packing desk',
      description: 'Keeps a light bag.',
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe('beta');

    mkdirSync(join(root, 'agents', 'beta'), { recursive: true });
    writeFileSync(join(root, 'agents', 'beta', 'MEMORY.md'), '# Memory\n');

    const saved = await request(app.getHttpServer()).post('/api/memory').send({
      agentId: 'beta',
      kind: 'preference',
      body: 'Beta prefers window seats.',
    });
    expect(saved.status).toBe(201);

    expect(readFileSync(join(root, 'agents', 'beta', 'MEMORY.md'), 'utf8')).toContain(
      'Beta prefers window seats.',
    );
    const shared = await request(app.getHttpServer()).get('/api/workspace');
    expect(shared.body.memory).not.toContain('Beta prefers window seats.');

    const view = await request(app.getHttpServer()).get('/api/workspace?agentId=beta');
    expect(view.body.sources.memory).toEqual({
      source: 'agent',
      path: 'agents/beta/MEMORY.md',
    });
  });

  it('ignores an agent id that names no folder instead of inventing one', async () => {
    const ghost = await request(app.getHttpServer()).get('/api/workspace?agentId=ghost');
    expect(ghost.status).toBe(200);
    expect(ghost.body.sources.soul).toEqual({ source: 'shared', path: 'SOUL.md' });
    expect(existsSync(join(root, 'agents', 'ghost'))).toBe(false);
  });
});

describe('MEMORY.md boot import with a per-agent folder', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-workspace-'));
  const root = join(dir, 'workspace');

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = root;
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'mock';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;

    // Pre-seed both files: the override must win for the agent that owns the folder,
    // and the shared file must stay untouched for everyone else.
    mkdirSync(join(root, 'agents', 'marlow'), { recursive: true });
    writeFileSync(
      join(root, 'MEMORY.md'),
      '# Memory\n\n- [fact] Shared desk note. (2026-01-01)\n',
    );
    writeFileSync(
      join(root, 'agents', 'marlow', 'MEMORY.md'),
      '# Memory\n\n- [fact] Marlow keeps his own note. (2026-01-02)\n',
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('imports the override MEMORY.md for the default agent, not the shared one', async () => {
    const res = await request(app.getHttpServer()).get('/api/memory');
    expect(res.status).toBe(200);
    const bodies = res.body.map((note: { body: string }) => note.body);
    expect(bodies).toContain('Marlow keeps his own note.');
    expect(bodies).not.toContain('Shared desk note.');
  });

  it('still reports the shared file for a caller that names no agent', async () => {
    const res = await request(app.getHttpServer()).get('/api/workspace');
    expect(res.body.memory).toContain('Shared desk note.');
    expect(res.body.sources.memory).toEqual({ source: 'shared', path: 'MEMORY.md' });
  });
});
