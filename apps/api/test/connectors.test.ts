import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Connectors are operator-held provider keys that built-in tools resolve by
 * name. The traveler never provides one: provider access is the desk's job.
 * The key travels only in an Authorization header — never in a chat turn, a
 * stored transcript, or an error string — and there is no HTTP surface for
 * reading or writing connectors at all.
 */
describe('provider connectors', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-connectors-'));
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const seen: Array<{ url: string; auth: string | null }> = [];
  let ratesStatus = 200;

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '1';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_CURRENCY_BASE_URL;
    delete process.env.TRAVELCLAW_CURRENCY_API_KEY;
    delete process.env.TRAVELCLAW_WEATHER_BASE_URL;
    delete process.env.TRAVELCLAW_WEATHER_API_KEY;

    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url: String(url), auth: headers.Authorization ?? null });
      return new Response(JSON.stringify({ rates: { EUR: 92 } }), {
        status: ratesStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    await app.close();
  });

  beforeEach(() => {
    seen.length = 0;
    ratesStatus = 200;
  });

  async function signedInAgent() {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/register').send({
      email: `connector-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'correct horse battery staple',
      displayName: 'Connector Traveler',
    });
    expect(res.status).toBe(201);
    return agent;
  }

  it('runs a tool through the operator connector without leaking the key', async () => {
    process.env.TRAVELCLAW_CURRENCY_BASE_URL = 'https://rates.example.com';
    process.env.TRAVELCLAW_CURRENCY_API_KEY = 'sk-operator-rates-4455';
    try {
      const agent = await signedInAgent();
      const res = await agent.post('/api/chat').send({ content: 'convert 100 USD to EUR' });

      expect(res.status).toBe(201);
      expect(res.body.tools).toEqual([
        {
          name: 'currency.convert',
          ok: true,
          summary: expect.stringMatching(/100 USD is about 92 EUR/),
          source: 'router',
        },
      ]);
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe(
        'https://rates.example.com/latest?from=USD&to=EUR&amount=100',
      );
      expect(seen[0].auth).toBe('Bearer sk-operator-rates-4455');
      // The turn's reply, trace, and stored transcript carry no secret.
      expect(JSON.stringify(res.body)).not.toContain('sk-operator-rates-4455');
      const stored = await agent.get(`/api/sessions/${res.body.session.id}`);
      expect(JSON.stringify(stored.body)).not.toContain('sk-operator-rates-4455');
    } finally {
      delete process.env.TRAVELCLAW_CURRENCY_BASE_URL;
      delete process.env.TRAVELCLAW_CURRENCY_API_KEY;
    }
  });

  it('falls back to the desk table when the provider refuses the key', async () => {
    process.env.TRAVELCLAW_CURRENCY_API_KEY = 'sk-rejected-key';
    ratesStatus = 401;
    try {
      const agent = await signedInAgent();
      const res = await agent.post('/api/chat').send({ content: 'convert 100 USD to EUR' });

      expect(res.status).toBe(201);
      expect(res.body.tools[0].summary).toMatch(/desk-table/);
      expect(JSON.stringify(res.body)).not.toContain('sk-rejected-key');
    } finally {
      delete process.env.TRAVELCLAW_CURRENCY_API_KEY;
    }
  });

  it('exposes no HTTP surface for connectors', async () => {
    const agent = await signedInAgent();
    const res = await agent.get('/api/connectors');
    expect(res.status).toBe(404);
  });
});
