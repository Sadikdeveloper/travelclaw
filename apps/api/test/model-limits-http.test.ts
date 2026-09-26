import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { labelFor, limitsFor } from '../src/models/model-catalog';

/**
 * The desk picks its model; a turn does not. Everyone — guest and signed-in account alike —
 * is answered by the best model this deployment has, and what differs between tiers is only
 * the pace on that model.
 *
 * The provider is stubbed in-process and every request to it is recorded, so "which model
 * ran" is asserted against what the desk actually asked the provider for, not against the
 * name in the reply.
 */
describe('auto-selected model and its pace, over HTTP', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-model-limits-'));
  const originalFetch = global.fetch;
  /** Every `model` the desk has asked the provider for, in order. */
  const asked: string[] = [];

  /** The best model this test's config can run: the big one, since a key is configured. */
  const chosen = 'gpt-4o';
  const limits = limitsFor(chosen);

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
    process.env.TRAVELCLAW_MODEL_BASE_URL = 'https://model.test/v1';
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;

    global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      asked.push((JSON.parse(String(init?.body)) as { model: string }).model);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Noted at the desk.' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
  });

  type Agent = ReturnType<typeof request.agent>;

  async function guest(ua: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/guest').set('User-Agent', ua);
    const session = await agent.post('/api/sessions').send({ channel: 'webchat' });
    return { agent, sessionId: session.body.id as string };
  }

  function turn(agent: Agent, sessionId: string, body: Record<string, unknown> = {}) {
    return agent
      .post(`/api/sessions/${sessionId}/messages`)
      .set('User-Agent', 'test/model-limits')
      .send({ content: 'hello', ...body });
  }

  it('runs the best model this deployment has, for a guest and for an account alike', async () => {
    const { agent, sessionId } = await guest('test/same-model');
    const asGuest = await turn(agent, sessionId);
    expect(asGuest.status).toBe(201);
    expect(asGuest.body.model).toBe(chosen);
    // The strongest configured model, not the first one listed, is what the provider saw.
    expect(asked.at(-1)).toBe(chosen);

    const account = request.agent(app.getHttpServer());
    const registered = await account
      .post('/api/auth/register')
      .set('User-Agent', 'test/same-model-account')
      .send({
        email: `model-${Math.random().toString(36).slice(2)}@example.com`,
        password: 'a very good passphrase',
      });
    expect(registered.status).toBe(201);
    const session = await account.post('/api/sessions').send({ channel: 'webchat' });
    const asAccount = await turn(account, session.body.id);
    expect(asAccount.status).toBe(201);
    // Same model, different allowance — that is what signing in buys.
    expect(asAccount.body.model).toBe(asGuest.body.model);
    expect(asked.at(-1)).toBe(chosen);
  });

  it('refuses a turn that asks for a model, instead of answering with a different one', async () => {
    const { agent, sessionId } = await guest('test/no-choice');
    for (const picked of ['travelclaw-local', 'gpt-4o-mini', 'not-a-model']) {
      const res = await turn(agent, sessionId, { model: picked });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('model_selection_unsupported');
      expect(res.body.error.message).toMatch(/desk chooses its own model/i);
    }
    // The very next turn still works, on the desk's own choice.
    const next = await turn(agent, sessionId);
    expect(next.status).toBe(201);
    expect(next.body.model).toBe(chosen);
  });

  it('enforces the chosen model’s guest pace, and says which model ran out', async () => {
    const { agent, sessionId } = await guest('test/guest-pace');
    for (let i = 0; i < limits.guest; i += 1) {
      expect((await turn(agent, sessionId)).status).toBe(201);
    }
    const paced = await turn(agent, sessionId);
    expect(paced.status).toBe(429);
    expect(paced.body.error.code).toBe('rate_limited');
    expect(paced.body.error.message).toContain(labelFor(chosen));
    expect(paced.body.error.message).toContain(`${limits.guest} turns every 10 minutes`);
    expect(paced.body.error.message).toMatch(/sign in for a higher limit/i);
    // Never a sign-in wall.
    expect(paced.body.error.message).not.toMatch(/sign in to use this/i);
  });

  it('lets a signed-in account take more than a guest on the same model', async () => {
    const agent = request.agent(app.getHttpServer());
    const registered = await agent
      .post('/api/auth/register')
      .set('User-Agent', 'test/account-pace')
      .send({
        email: `pace-${Math.random().toString(36).slice(2)}@example.com`,
        password: 'a very good passphrase',
      });
    expect(registered.status).toBe(201);
    const session = await agent.post('/api/sessions').send({ channel: 'webchat' });

    for (let i = 0; i <= limits.guest; i += 1) {
      expect((await turn(agent, session.body.id)).status).toBe(201);
    }
    let last: { status: number; body: { error?: { message?: string; code?: string } } } = {
      status: 0,
      body: {},
    };
    for (let i = 0; i < limits.account; i += 1) {
      last = await turn(agent, session.body.id);
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
    expect(last.body.error?.message).toContain(`${limits.account} turns every 10 minutes`);
    expect(last.body.error?.message).not.toMatch(/sign in/i);
  });

  it('reports the model it is using, and that model’s limits, on the catalog', async () => {
    const { agent } = await guest('test/catalog-reader');
    const res = await agent.get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.current).toBe(chosen);
    const byId = Object.fromEntries(
      (res.body.models as { id: string; limits: { guest: number; account: number } }[]).map(
        (model) => [model.id, model.limits],
      ),
    );
    // What the API calls the limits is what a turn is actually paced by.
    expect(byId[chosen]).toEqual(limits);
    for (const entry of Object.values(byId)) {
      expect(entry.account).toBeGreaterThan(entry.guest);
    }
  });

  it('drops to the offline desk model when the key goes away', async () => {
    const previous = process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    try {
      const { agent, sessionId } = await guest('test/keyless');
      const res = await turn(agent, sessionId);
      expect(res.status).toBe(201);
      expect(res.body.model).toBe('travelclaw-local');
      expect(res.body.provider).toBe('mock');
      const catalog = await agent.get('/api/models');
      expect(catalog.body.current).toBe('travelclaw-local');
    } finally {
      process.env.TRAVELCLAW_MODEL_API_KEY = previous;
    }
  });
});
