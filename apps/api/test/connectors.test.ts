import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Connectors are keys a traveler provides, not a new language: they are stored
 * per account, resolved by name inside built-in tools, and never echoed back —
 * not in a response, an error string, or a chat turn.
 */
describe('connectors', () => {
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

  it('lists every supported connector as missing for a fresh account', async () => {
    const agent = await signedInAgent();
    const res = await agent.get('/api/connectors');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        name: 'currency',
        label: 'Rates',
        detail: expect.any(String),
        status: 'missing',
        source: null,
        baseUrl: null,
        keySuffix: null,
        updatedAt: null,
      },
      {
        name: 'weather',
        label: 'Forecast',
        detail: expect.any(String),
        status: 'missing',
        source: null,
        baseUrl: null,
        keySuffix: null,
        updatedAt: null,
      },
    ]);
  });

  it('stores a connector and never returns the secret', async () => {
    const agent = await signedInAgent();
    const key = 'sk-rates-key-7890';
    const saved = await agent.put('/api/connectors/currency').send({
      baseUrl: 'https://rates.example.com/',
      apiKey: key,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      name: 'currency',
      status: 'configured',
      source: 'account',
      baseUrl: 'https://rates.example.com',
      keySuffix: '7890',
    });
    expect(JSON.stringify(saved.body)).not.toContain(key);

    const listed = await agent.get('/api/connectors');
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(key);
    expect(
      listed.body.find((entry: { name: string }) => entry.name === 'currency'),
    ).toMatchObject({ status: 'configured', keySuffix: '7890' });
  });

  it('runs a tool through the stored connector without leaking the key', async () => {
    const agent = await signedInAgent();
    const key = 'sk-live-rates-4455';
    await agent.put('/api/connectors/currency').send({
      baseUrl: 'https://rates.example.com',
      apiKey: key,
    });

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
    expect(seen[0].url).toBe('https://rates.example.com/latest?from=USD&to=EUR&amount=100');
    expect(seen[0].auth).toBe(`Bearer ${key}`);
    // The turn's reply, trace, and stored transcript carry no secret.
    expect(JSON.stringify(res.body)).not.toContain(key);
    const stored = await agent.get(`/api/sessions/${res.body.session.id}`);
    expect(JSON.stringify(stored.body)).not.toContain(key);
  });

  it('marks a connector rejected when its provider refuses the key', async () => {
    const agent = await signedInAgent();
    await agent.put('/api/connectors/currency').send({ apiKey: 'sk-bad-key' });
    ratesStatus = 401;

    const res = await agent.post('/api/chat').send({ content: 'convert 100 USD to EUR' });
    // The desk table is the labeled fallback: the turn still answers.
    expect(res.status).toBe(201);
    expect(res.body.tools[0].summary).toMatch(/desk-table/);

    const listed = await agent.get('/api/connectors');
    expect(
      listed.body.find((entry: { name: string }) => entry.name === 'currency').status,
    ).toBe('rejected');

    // Saving again clears the flag.
    const saved = await agent
      .put('/api/connectors/currency')
      .send({ apiKey: 'sk-new-key' });
    expect(saved.body.status).toBe('configured');
  });

  it('keeps an omitted field and clears an emptied one', async () => {
    const agent = await signedInAgent();
    await agent.put('/api/connectors/currency').send({
      baseUrl: 'https://rates.example.com',
      apiKey: 'sk-keep-me-1122',
    });
    // Only the base URL is resent: the key stays.
    const kept = await agent.put('/api/connectors/currency').send({
      baseUrl: 'https://other.example.com',
    });
    expect(kept.body).toMatchObject({
      baseUrl: 'https://other.example.com',
      keySuffix: '1122',
      status: 'configured',
    });
    // An empty key clears it; the base URL alone still configures.
    const cleared = await agent.put('/api/connectors/currency').send({ apiKey: '' });
    expect(cleared.body).toMatchObject({
      baseUrl: 'https://other.example.com',
      keySuffix: null,
      status: 'configured',
    });
  });

  it('refuses validation failures without echoing the key', async () => {
    const agent = await signedInAgent();
    const key = 'sk-never-echoed-6677';
    const badUrl = await agent.put('/api/connectors/currency').send({
      baseUrl: 'ftp://rates.example.com',
      apiKey: key,
    });
    expect(badUrl.status).toBe(400);
    expect(JSON.stringify(badUrl.body)).not.toContain(key);

    const unknown = await agent.put('/api/connectors/flights').send({ apiKey: key });
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(unknown.body)).not.toContain(key);

    const empty = await agent.put('/api/connectors/weather').send({ apiKey: '' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('connector_empty');
  });

  it('falls back to the operator environment when a traveler stored nothing', async () => {
    process.env.TRAVELCLAW_CURRENCY_BASE_URL = 'https://env-rates.example.com';
    process.env.TRAVELCLAW_CURRENCY_API_KEY = 'sk-env-operator-key';
    try {
      const agent = await signedInAgent();
      const listed = await agent.get('/api/connectors');
      expect(
        listed.body.find((entry: { name: string }) => entry.name === 'currency'),
      ).toMatchObject({
        status: 'configured',
        source: 'environment',
        baseUrl: 'https://env-rates.example.com',
        // Not even a suffix: the operator's key is not this traveler's to inspect.
        keySuffix: null,
      });
      expect(JSON.stringify(listed.body)).not.toContain('sk-env-operator-key');

      const res = await agent.post('/api/chat').send({ content: 'convert 100 USD to EUR' });
      expect(res.status).toBe(201);
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe(
        'https://env-rates.example.com/latest?from=USD&to=EUR&amount=100',
      );
      expect(seen[0].auth).toBe('Bearer sk-env-operator-key');
      expect(JSON.stringify(res.body)).not.toContain('sk-env-operator-key');
    } finally {
      delete process.env.TRAVELCLAW_CURRENCY_BASE_URL;
      delete process.env.TRAVELCLAW_CURRENCY_API_KEY;
    }
  });

  it('forgets a connector on delete and keeps accounts apart', async () => {
    const first = await signedInAgent();
    await first.put('/api/connectors/weather').send({ apiKey: 'sk-first-2233' });
    const removed = await first.delete('/api/connectors/weather');
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ name: 'weather', status: 'missing' });

    // A second account never saw the first one's row.
    const second = await signedInAgent();
    const listed = await second.get('/api/connectors');
    expect(
      listed.body.find((entry: { name: string }) => entry.name === 'weather').status,
    ).toBe('missing');
  });
});
