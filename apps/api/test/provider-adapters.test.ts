import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadConfig } from '../src/config';

/**
 * Vendor adapters configured through the operator env. The desk must reach the
 * vendor's own API shape, keep the key off the wire in any place a summary or a
 * task row could echo, and never offer a hold a vendor cannot confirm.
 */
describe('vendor provider adapters', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-adapters-'));
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const seen: Array<{ url: string; method: string; auth: string | null }> = [];

  const flightsPayload = {
    search_parameters: { engine: 'google_flights', currency: 'EUR' },
    best_flights: [
      {
        flights: [
          {
            departure_airport: {
              name: 'Murtala Muhammed',
              id: 'LOS',
              time: '2026-11-02 08:00',
            },
            arrival_airport: {
              name: 'Humberto Delgado',
              id: 'LIS',
              time: '2026-11-02 15:30',
            },
            airline: 'Example Air',
            flight_number: 'EX 1',
          },
        ],
        price: 620.5,
      },
    ],
  };

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '1';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'mock';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;

    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        url: String(url),
        method: init?.method ?? 'GET',
        auth: headers.Authorization ?? null,
      });
      const target = String(url);
      const lookup = /q=([^&]+)/.exec(target)?.[1];
      const body = target.includes('google_flights_autocomplete')
        ? {
            suggestions: [
              lookup === 'Lagos'
                ? { name: 'Lagos', id: '/m/06n0v', airports: [{ id: 'LOS' }] }
                : { name: 'Lisbon', id: '/m/04jpl', airports: [{ id: 'LIS' }] },
            ],
          }
        : flightsPayload;
      return new Response(JSON.stringify(body), {
        status: 200,
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
    delete process.env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON;
    delete process.env.TRAVELCLAW_STAY_PROVIDERS_JSON;
    delete process.env.TRAVELCLAW_FLIGHT_BASE_URL;
    delete process.env.TRAVELCLAW_FLIGHT_API_KEY;
  });

  async function guestAgent() {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/guest').send({});
    expect(res.status).toBe(200);
    return agent;
  }

  it('reaches SerpApi through its own engine and never offers a hold Google Flights cannot confirm', async () => {
    process.env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON = JSON.stringify([
      {
        id: 'serpapi-flights',
        adapter: 'serpapi',
        apiKey: 'serpapi-operator-key-9931',
      },
    ]);
    const agent = await guestAgent();

    const response = await agent
      .post('/api/chat')
      .send({ content: 'Find a flight from Lagos to Lisbon on 2026-11-02' });
    expect(response.status).toBe(201);

    const tasks = await agent.get(`/api/sessions/${response.body.session.id}/tasks`);
    expect(tasks.status).toBe(200);
    const task = tasks.body[0];

    // Both cities went through the vendor's own lookup, then one search. The
    // adapter default filled the base URL in; the key travelled in a header.
    expect(seen).toHaveLength(3);
    expect(seen[0].url).toBe(
      'https://serpapi.com/search?engine=google_flights_autocomplete&q=Lagos',
    );
    expect(seen[1].url).toBe(
      'https://serpapi.com/search?engine=google_flights_autocomplete&q=Lisbon',
    );
    expect(seen[2].url).toContain('https://serpapi.com/search?engine=google_flights');
    expect(seen[2].url).toContain('departure_id=%2Fm%2F06n0v');
    expect(seen[2].url).toContain('arrival_id=%2Fm%2F04jpl');
    expect(seen.every((call) => call.auth === 'Bearer serpapi-operator-key-9931')).toBe(
      true,
    );
    expect(seen.every((call) => !call.url.includes('serpapi-operator-key-9931'))).toBe(
      true,
    );

    expect(task.summary).toContain('SerpApi');
    expect(task.offers).toHaveLength(1);
    expect(task.offers[0]).toMatchObject({
      providerOfferId: expect.stringContaining('serpapi-flight'),
      currency: 'EUR',
      totalAmount: 620.5,
      hold: 'none',
      holdSupport: 'unsupported',
    });
    expect(JSON.stringify(task)).not.toContain('serpapi-operator-key-9931');

    // The hold action is refused with a reason, not attempted against a vendor
    // that has no hold endpoint — and nothing new goes out on the wire.
    const attemptsBefore = seen.length;
    const hold = await agent
      .post(`/api/tasks/${task.id}/offers/${task.offers[0].id}/hold`)
      .send({ confirm: true });
    expect(hold.status).toBe(201);
    expect(hold.body.confirmed).toBe(false);
    expect(hold.body.note).toContain('does not confirm holds');
    expect(hold.body.offer.hold).toBe('none');
    expect(hold.body.offer.holdSupport).toBe('unsupported');
    expect(seen).toHaveLength(attemptsBefore);
  });

  it('refuses a provider adapter that cannot serve the configured kind', () => {
    process.env.TRAVELCLAW_STAY_PROVIDERS_JSON = JSON.stringify([
      { id: 'flights-only', adapter: 'flightapi', apiKey: 'key' },
    ]);
    expect(() => loadConfig()).toThrow(/cannot serve a stay search/);
    delete process.env.TRAVELCLAW_STAY_PROVIDERS_JSON;
  });

  it('refuses an adapter name this build does not have', () => {
    process.env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON = JSON.stringify([
      {
        id: 'mystery',
        adapter: 'someone-elses-api',
        apiKey: 'key',
        baseUrl: 'https://x.test',
      },
    ]);
    expect(() => loadConfig()).toThrow(/adapter must be one of/);
  });

  it('validates operator place aliases instead of passing a guess to a vendor', () => {
    process.env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON = JSON.stringify([
      {
        id: 'aliased',
        adapter: 'serpapi',
        apiKey: 'key',
        cityCodes: { lagos: 'Lagos Nigeria' },
      },
    ]);
    expect(() => loadConfig()).toThrow(/airport code or a Google location id/);
  });

  it('keeps a compatible operator adapter exactly as it was', () => {
    process.env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON = JSON.stringify([
      {
        id: 'global',
        name: 'Global',
        baseUrl: 'https://fares.example.test',
        apiKey: 'key',
      },
    ]);
    const config = loadConfig();
    expect(config.flightProviders).toEqual([
      {
        id: 'global',
        name: 'Global',
        adapter: 'travelclaw',
        baseUrl: 'https://fares.example.test',
        apiKey: 'key',
      },
    ]);
  });
});
