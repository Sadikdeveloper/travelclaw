import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { limitsFor } from '../src/models/model-catalog';

/**
 * Turns are paced per model and per tier: a guest gets a taste of each model, a signed-in
 * account gets several times more, and a bigger model is rationed tighter than a small one.
 * The live provider is pointed at a dead port on purpose — these tests are about the pace,
 * not the model's answers, and a failed live call already falls back to the desk rendering.
 */
describe('per-model turn limits over HTTP', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-model-limits-'));

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'openai';
    process.env.TRAVELCLAW_MODEL_API_KEY = 'sk-test';
    process.env.TRAVELCLAW_MODEL_NAME = 'gpt-4o-mini';
    process.env.TRAVELCLAW_MODELS = 'gpt-4o-mini,gpt-4o';
    process.env.TRAVELCLAW_MODEL_BASE_URL = 'http://127.0.0.1:9/v1';
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  type Agent = ReturnType<typeof request.agent>;

  async function guest(ua: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/guest').set('User-Agent', ua);
    const session = await agent.post('/api/sessions').send({ channel: 'webchat' });
    return { agent, sessionId: session.body.id as string };
  }

  function turn(agent: Agent, sessionId: string, model: string) {
    return agent
      .post(`/api/sessions/${sessionId}/messages`)
      .set('User-Agent', 'test/model-limits')
      .send({ content: 'hello', model });
  }

  it('reports the pace on every model, per tier', async () => {
    const { agent } = await guest('test/catalog-reader');
    const res = await agent.get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.current).toBe('gpt-4o-mini');
    const byId = Object.fromEntries(
      (res.body.models as { id: string; limits: { guest: number; account: number } }[]).map(
        (model) => [model.id, model.limits],
      ),
    );
    expect(byId['gpt-4o-mini']).toEqual(limitsFor('gpt-4o-mini'));
    expect(byId['gpt-4o']).toEqual(limitsFor('gpt-4o'));
    expect(byId['travelclaw-local']).toEqual(limitsFor('travelclaw-local'));
    // The point of the whole thing: signing in buys more, on each model.
    for (const limits of Object.values(byId)) {
      expect(limits.account).toBeGreaterThan(limits.guest);
    }
  });

  it('paces each model separately, so one model running out leaves the others alone', async () => {
    const { agent, sessionId } = await guest('test/per-model-guest');
    const mini = limitsFor('gpt-4o-mini');

    for (let i = 0; i < mini.guest; i += 1) {
      const allowed = await turn(agent, sessionId, 'gpt-4o-mini');
      expect(allowed.status).toBe(201);
    }

    const paced = await turn(agent, sessionId, 'gpt-4o-mini');
    expect(paced.status).toBe(429);
    expect(paced.body.error.code).toBe('rate_limited');
    // The refusal names the model and the tier, and never reads as a sign-in wall.
    expect(paced.body.error.message).toContain('GPT-4o mini');
    expect(paced.body.error.message).toContain(`${mini.guest} turns every 10 minutes`);
    expect(paced.body.error.message).toMatch(/sign in for a higher limit/i);
    expect(paced.body.error.message).not.toMatch(/sign in to use this/i);

    // A different model has its own allowance, untouched by the model that just ran out.
    const elsewhere = await turn(agent, sessionId, 'gpt-4o');
    expect(elsewhere.status).toBe(201);
    const desk = await turn(agent, sessionId, 'travelclaw-local');
    expect(desk.status).toBe(201);
  });

  it('gives a signed-in account more than a guest on the same model', async () => {
    const agent = request.agent(app.getHttpServer());
    const registered = await agent
      .post('/api/auth/register')
      .set('User-Agent', 'test/account-tier')
      .send({ email: `limits-${Math.random().toString(36).slice(2)}@example.com`, password: 'a very good passphrase' });
    expect(registered.status).toBe(201);
    const session = await agent.post('/api/sessions').send({ channel: 'webchat' });

    const mini = limitsFor('gpt-4o-mini');
    // More turns than a guest is allowed on this model, all accepted.
    for (let i = 0; i <= mini.guest; i += 1) {
      const allowed = await turn(agent, session.body.id, 'gpt-4o-mini');
      expect(allowed.status).toBe(201);
    }

    // Keep going to the account ceiling, then confirm it stops — and says so without
    // pretending the traveler needs to sign in.
    let last = { status: 0, body: { error: { message: '' } } };
    for (let i = 0; i < mini.account; i += 1) {
      last = await turn(agent, session.body.id, 'gpt-4o-mini');
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
    expect(last.body.error.message).toContain('GPT-4o mini');
    expect(last.body.error.message).toContain(`${mini.account} turns every 10 minutes`);
    expect(last.body.error.message).not.toMatch(/sign in/i);
  });

  it('rejects a model this desk does not run instead of quietly using another one', async () => {
    const { agent, sessionId } = await guest('test/unknown-model');
    const res = await turn(agent, sessionId, 'not-a-model');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('model_unknown');
    // The desk's own model still answers, so the traveler is not left with nothing.
    expect((await turn(agent, sessionId, 'travelclaw-local')).status).toBe(201);
  });

  it('keeps a configured-but-keyless model out of reach, and off the default path', async () => {
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    const { agent, sessionId } = await guest('test/keyless-model');
    const res = await turn(agent, sessionId, 'gpt-4o');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('model_unavailable');

    const catalog = await agent.get('/api/models');
    expect(catalog.body.current).toBe('travelclaw-local');
    expect(
      (catalog.body.models as { id: string; available: boolean }[]).find(
        (model) => model.id === 'gpt-4o',
      )?.available,
    ).toBe(false);
    // A turn that names no model runs on the desk model, which never needed a key.
    expect((await turn(agent, sessionId, 'travelclaw-local')).status).toBe(201);
    process.env.TRAVELCLAW_MODEL_API_KEY = 'sk-test';
  });
});
