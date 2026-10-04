import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('flight and stay provider search', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-search-'));
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const seen: Array<{ url: string; method: string; auth: string | null; body?: string }> =
    [];
  let searchStatus = 200;
  let searchBody: unknown = { provider: 'Test Air', offers: [] };
  let regionalSearchBody: unknown | null = null;
  let regionalSearchStatus: number | null = null;
  let staySearchBody: unknown = { provider: 'Test Stay', offers: [] };
  let staySearchStatus = 200;
  let holdStatus = 200;
  let holdBody: unknown = { status: 'requested' };

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '1';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'mock';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON;
    delete process.env.TRAVELCLAW_STAY_PROVIDERS_JSON;
    delete process.env.TRAVELCLAW_BOOKER_COUNTRY;
    delete process.env.TRAVELCLAW_SEARCH_CURRENCY;
    delete process.env.TRAVELCLAW_SEARCH_LANGUAGE;
    delete process.env.TRAVELCLAW_FLIGHT_BASE_URL;
    delete process.env.TRAVELCLAW_FLIGHT_API_KEY;
    delete process.env.TRAVELCLAW_STAY_BASE_URL;
    delete process.env.TRAVELCLAW_STAY_API_KEY;
    delete process.env.TRAVELCLAW_CURRENCY_BASE_URL;
    delete process.env.TRAVELCLAW_CURRENCY_API_KEY;
    delete process.env.TRAVELCLAW_WEATHER_BASE_URL;
    delete process.env.TRAVELCLAW_WEATHER_API_KEY;

    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        url: String(url),
        method: init?.method ?? 'GET',
        auth: headers.Authorization ?? null,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (parsed.pathname.endsWith('/holds')) {
        return new Response(JSON.stringify(holdBody), {
          status: holdStatus,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const isStay = parsed.pathname.endsWith('/search/stays');
      const isRegional = parsed.hostname.startsWith('regional-');
      const body = isStay
        ? staySearchBody
        : isRegional && regionalSearchBody !== null
          ? regionalSearchBody
          : searchBody;
      const status = isStay
        ? staySearchStatus
        : isRegional && regionalSearchStatus !== null
          ? regionalSearchStatus
          : searchStatus;
      return new Response(JSON.stringify(body), {
        status,
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
    searchStatus = 200;
    searchBody = { provider: 'Test Air', offers: [] };
    regionalSearchBody = null;
    regionalSearchStatus = null;
    staySearchBody = { provider: 'Test Stay', offers: [] };
    staySearchStatus = 200;
    holdStatus = 200;
    holdBody = { status: 'requested' };
    delete process.env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON;
    delete process.env.TRAVELCLAW_STAY_PROVIDERS_JSON;
    delete process.env.TRAVELCLAW_BOOKER_COUNTRY;
    delete process.env.TRAVELCLAW_SEARCH_CURRENCY;
    delete process.env.TRAVELCLAW_SEARCH_LANGUAGE;
    delete process.env.TRAVELCLAW_FLIGHT_BASE_URL;
    delete process.env.TRAVELCLAW_FLIGHT_API_KEY;
    delete process.env.TRAVELCLAW_STAY_BASE_URL;
    delete process.env.TRAVELCLAW_STAY_API_KEY;
  });

  async function signedInAgent() {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/register').send({
      email: `provider-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'correct horse battery staple',
      displayName: 'Provider Traveler',
    });
    expect(res.status).toBe(201);
    return agent;
  }

  async function guestAgent() {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/guest').send({});
    expect(res.status).toBe(200);
    return agent;
  }

  function flightOffer(id = 'F-1020') {
    return {
      id,
      price: { amount: '182.40', currency: 'EUR' },
      segments: [{ from: 'LOS', to: 'LIS', carrier: 'Test Air' }],
    };
  }

  async function searchFlight(agent: ReturnType<typeof request.agent>) {
    return agent.post('/api/chat').send({
      content: 'Find a flight from Lagos to Lisbon on 2026-11-02',
    });
  }

  async function taskFor(agent: ReturnType<typeof request.agent>, sessionId: string) {
    const response = await agent.get(`/api/sessions/${sessionId}/tasks`);
    expect(response.status).toBe(200);
    return response.body[0];
  }

  it('persists real provider offers with provider, retrieval time, and header-only key', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test/v1';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'operator-secret-1902';
    searchBody = {
      provider: 'Fare Shop',
      offers: [flightOffer(), { id: 'unpriced' }],
    };
    const agent = await signedInAgent();

    const response = await searchFlight(agent);
    expect(response.status).toBe(201);
    const task = await taskFor(agent, response.body.session.id);

    expect(task.summary).toContain('Provider: Fare Shop. Retrieved ');
    expect(task.summary).toContain('182.4 EUR');
    expect(task.summary).toContain('offer only; no hold confirmed');
    expect(task.summary).toContain('Search assumed one traveler');
    expect(task.summary).toContain('one-way');
    expect(task.summary).toContain('Nothing was purchased.');
    expect(task.offers).toHaveLength(1);
    expect(task.offers[0]).toMatchObject({
      provider: 'Fare Shop',
      providerOfferId: 'F-1020',
      currency: 'EUR',
      totalAmount: 182.4,
      hold: 'none',
    });
    expect(task.offers[0].retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(
      'https://fares.example.test/v1/search/flights?origin=Lagos&destination=Lisbon&departDate=2026-11-02&travelers=1',
    );
    expect(seen[0].auth).toBe('Bearer operator-secret-1902');
    expect(seen[0].url).not.toContain('operator-secret-1902');
    expect(JSON.stringify(task)).not.toContain('operator-secret-1902');
    expect(JSON.stringify(task)).not.toContain('fares.example.test/v1');
  });

  it('searches and stores one flight and one stay provider in the same chat', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'flight-key';
    process.env.TRAVELCLAW_STAY_BASE_URL = 'https://beds.example.test';
    process.env.TRAVELCLAW_STAY_API_KEY = 'stay-key';
    searchBody = { provider: 'Fare Shop', offers: [flightOffer()] };
    staySearchBody = {
      provider: 'Bed Shop',
      offers: [
        {
          id: 'ROOM-1',
          price: { amount: 420, currency: 'EUR' },
          stay: { name: 'Casa do Rio', roomType: 'double', nights: 4 },
        },
      ],
    };
    const agent = await signedInAgent();

    const response = await agent.post('/api/chat').send({
      content:
        'Find a flight from Lagos to Lisbon from 2026-11-02 to 2026-11-06 and a hotel in Lisbon for 2 from 2026-11-02 to 2026-11-06',
    });
    expect(response.status).toBe(201);
    const listed = await agent.get(`/api/sessions/${response.body.session.id}/tasks`);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(2);
    const flight = listed.body.find((task: { kind: string }) => task.kind === 'flight');
    const stay = listed.body.find((task: { kind: string }) => task.kind === 'stay');
    expect(flight.offers[0]).toMatchObject({
      provider: 'Fare Shop',
      providerOfferId: 'F-1020',
    });
    expect(stay.offers[0]).toMatchObject({
      provider: 'Bed Shop',
      providerOfferId: 'ROOM-1',
      title: 'Casa do Rio',
      totalAmount: 420,
    });
    expect(seen.map((call) => new URL(call.url).pathname).sort()).toEqual([
      '/search/flights',
      '/search/stays',
    ]);
    expect(seen.find((call) => call.url.includes('/search/flights'))?.auth).toBe(
      'Bearer flight-key',
    );
    expect(seen.find((call) => call.url.includes('/search/stays'))?.auth).toBe(
      'Bearer stay-key',
    );
  });

  it('uses the market the message states, with the operator default only for keys it omits', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    process.env.TRAVELCLAW_BOOKER_COUNTRY = 'US';
    process.env.TRAVELCLAW_SEARCH_CURRENCY = 'USD';
    process.env.TRAVELCLAW_SEARCH_LANGUAGE = 'en-US';
    const agent = await guestAgent();

    const response = await agent.post('/api/chat').send({
      content:
        'Find a flight from Lagos to Lisbon on 2026-11-02. I am based in Nigeria, price it in NGN',
    });
    expect(response.status).toBe(201);
    const task = await taskFor(agent, response.body.session.id);

    // The traveler's own words win; the operator default still fills the key they left out.
    expect(task.summary).toContain(
      'Pricing context: booker country NG (your message), requested currency NGN (your message), content language en-US (operator default).',
    );
    expect(seen).toHaveLength(1);
    const url = seen[0].url;
    expect(url).toContain('bookerCountry=NG');
    expect(url).toContain('currency=NGN');
    expect(url).toContain('language=en-US');
    expect(url).not.toContain('bookerCountry=US');
    expect(url).not.toContain('currency=USD');
  });

  it('stores no market profile: the next search uses only the context it states', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    const agent = await guestAgent();

    const first = await agent.post('/api/chat').send({
      content: 'Find a flight from Lagos to Lisbon on 2026-11-02, price it in NGN',
    });
    expect(first.status).toBe(201);
    const priced = await taskFor(agent, first.body.session.id);
    expect(priced.summary).toContain(
      'Pricing context from your message: requested currency NGN.',
    );
    expect(seen[0].url).toContain('currency=NGN');

    const me = await agent.get('/api/auth/me');
    expect(me.body).not.toHaveProperty('market');

    const plain = await searchFlight(agent);
    const unpriced = await taskFor(agent, plain.body.session.id);
    expect(unpriced.summary).not.toContain('Pricing context');
    expect(seen.at(-1)?.url).not.toContain('currency=');
  });

  it('fans out globally, passes the configured point of sale, and holds through the source that returned the offer', async () => {
    process.env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON = JSON.stringify([
      {
        id: 'global',
        name: 'Global Adapter',
        baseUrl: 'https://fares.example.test/global',
        apiKey: 'global-key',
      },
      {
        id: 'west-africa',
        name: 'West Africa Adapter',
        baseUrl: 'https://regional-fares.example.test',
        apiKey: 'regional-key',
      },
    ]);
    process.env.TRAVELCLAW_BOOKER_COUNTRY = 'ng';
    process.env.TRAVELCLAW_SEARCH_CURRENCY = 'ngn';
    process.env.TRAVELCLAW_SEARCH_LANGUAGE = 'en-NG';
    searchBody = { provider: 'Global Fares', offers: [flightOffer('G-1')] };
    regionalSearchBody = { provider: 'West Africa Fares', offers: [flightOffer('W-1')] };
    holdBody = { confirmed: true, ref: 'WEST-AFRICA-HOLD' };
    const agent = await signedInAgent();

    const response = await searchFlight(agent);
    const task = await taskFor(agent, response.body.session.id);

    expect(task.summary).toContain(
      'Pricing context from the operator default: booker country NG, requested currency NGN, content language en-NG.',
    );
    expect(task.offers).toHaveLength(2);
    expect(
      task.offers.map((offer: { providerOfferId: string }) => offer.providerOfferId),
    ).toEqual(['G-1', 'W-1']);
    expect(task.offers.map((offer: { provider: string }) => offer.provider)).toEqual([
      'Global Fares',
      'West Africa Fares',
    ]);
    expect(seen).toHaveLength(2);
    expect(seen.every((call) => call.url.includes('bookerCountry=NG'))).toBe(true);
    expect(seen.every((call) => call.url.includes('currency=NGN'))).toBe(true);
    expect(seen.every((call) => call.url.includes('language=en-NG'))).toBe(true);
    expect(JSON.stringify(task)).not.toContain('global-key');
    expect(JSON.stringify(task)).not.toContain('regional-key');
    expect(JSON.stringify(task)).not.toContain('fares.example.test');

    const attempted = await agent
      .post(`/api/tasks/${task.id}/offers/${task.offers[1].id}/hold`)
      .send({ confirm: true });

    expect(attempted.status).toBe(201);
    expect(attempted.body.confirmed).toBe(true);
    expect(seen.at(-1)).toMatchObject({
      url: 'https://regional-fares.example.test/holds',
      method: 'POST',
      auth: 'Bearer regional-key',
    });
  });

  it('stores no fake offers when the provider returns an empty list', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    searchBody = { provider: 'Fare Shop', offers: [] };
    const agent = await signedInAgent();

    const response = await searchFlight(agent);
    const task = await taskFor(agent, response.body.session.id);

    expect(task.summary).toContain('Provider: Fare Shop. Retrieved ');
    expect(task.summary).toContain('The provider returned no current offers.');
    expect(task.offers).toEqual([]);
  });

  it('does not query a stay provider until check-out is known', async () => {
    process.env.TRAVELCLAW_STAY_BASE_URL = 'https://beds.example.test';
    process.env.TRAVELCLAW_STAY_API_KEY = 'stay-key';
    const agent = await signedInAgent();

    const response = await agent.post('/api/chat').send({
      content: 'Find a hotel in Lisbon on 2026-11-02',
    });
    const task = await taskFor(agent, response.body.session.id);

    expect(task.summary).toContain('Provider search needs a check-out date after check-in');
    expect(task.offers).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it('reports provider errors without turning them into offers', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    searchStatus = 502;
    searchBody = { message: 'upstream is down' };
    const agent = await signedInAgent();

    const response = await searchFlight(agent);
    const task = await taskFor(agent, response.body.session.id);

    expect(task.summary).toContain('HTTP 502');
    expect(task.summary).toContain('No prices or availability are confirmed.');
    expect(task.offers).toEqual([]);
  });

  it('keeps the old brief and makes no provider call when the key is absent', async () => {
    const agent = await signedInAgent();

    const response = await searchFlight(agent);
    const task = await taskFor(agent, response.body.session.id);

    expect(task.summary).toBe(
      'Flight desk finished a brief for Lagos to Lisbon on 2026-11-02. No seat is held. Nothing was purchased.',
    );
    expect(task.offers).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it('keeps an unconfirmed hold as an offer after an explicit hold request', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    searchBody = { provider: 'Fare Shop', offers: [flightOffer()] };
    holdBody = { status: 'requested', message: 'We may have held it' };
    const agent = await signedInAgent();
    const response = await searchFlight(agent);
    const task = await taskFor(agent, response.body.session.id);
    const offer = task.offers[0];

    const attempted = await agent
      .post(`/api/tasks/${task.id}/offers/${offer.id}/hold`)
      .send({ confirm: true });

    expect(attempted.status).toBe(201);
    expect(attempted.body.confirmed).toBe(false);
    expect(attempted.body.offer.hold).toBe('none');
    expect(attempted.body.offer.holdRef).toBeNull();
    expect(attempted.body.offer.holdNote).toMatch(/did not confirm a hold/);
    expect(attempted.body.note).toMatch(/still an offer/);
    expect(seen.at(-1)).toMatchObject({
      url: 'https://fares.example.test/holds',
      method: 'POST',
      auth: 'Bearer key',
      body: JSON.stringify({ kind: 'flight', offerId: 'F-1020' }),
    });
    expect((await taskFor(agent, response.body.session.id)).offers[0].hold).toBe('none');
  });

  it('does not send an old offer to a provider that replaced its endpoint', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    searchBody = { provider: 'Fare Shop', offers: [flightOffer()] };
    const agent = await guestAgent();
    const response = await searchFlight(agent);
    const task = await taskFor(agent, response.body.session.id);
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://other-fares.example.test';

    const attempted = await agent
      .post(`/api/tasks/${task.id}/offers/${task.offers[0].id}/hold`)
      .send({ confirm: true });

    expect(attempted.status).toBe(201);
    expect(attempted.body.confirmed).toBe(false);
    expect(attempted.body.offer.hold).toBe('none');
    expect(attempted.body.note).toMatch(/provider changed since this offer was retrieved/);
    expect(seen).toHaveLength(1); // search only; the new provider got no old offer id
  });

  it('persists a hold only after the provider confirms one with a reference', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    searchBody = { provider: 'Fare Shop', offers: [flightOffer()] };
    holdBody = { confirmed: true, ref: 'HOLD-42', expiresAt: '2026-10-02T18:00:00Z' };
    const agent = await signedInAgent();
    const response = await searchFlight(agent);
    const task = await taskFor(agent, response.body.session.id);

    const attempted = await agent
      .post(`/api/tasks/${task.id}/offers/${task.offers[0].id}/hold`)
      .send({ confirm: true });

    expect(attempted.status).toBe(201);
    expect(attempted.body.confirmed).toBe(true);
    expect(attempted.body.offer).toMatchObject({
      hold: 'confirmed',
      holdRef: 'HOLD-42',
      holdExpiresAt: '2026-10-02T18:00:00Z',
    });
    expect(attempted.body.task.summary).toContain('provider-confirmed hold (HOLD-42)');
    expect(attempted.body.task.summary).not.toContain('No seat is held.');
    const later = await taskFor(agent, response.body.session.id);
    expect(later.offers[0].hold).toBe('confirmed');
    expect(later.offers[0].holdRef).toBe('HOLD-42');
    expect(later.summary).toContain('provider-confirmed hold (HOLD-42)');
    expect(later.summary).not.toContain('offer only; no hold confirmed');
    expect(later.summary).not.toContain('No seat is held.');

    const repeated = await agent
      .post(`/api/tasks/${task.id}/offers/${task.offers[0].id}/hold`)
      .send({ confirm: true });
    expect(repeated.status).toBe(201);
    expect(repeated.body.confirmed).toBe(true);
    expect(repeated.body.note).toMatch(/already confirmed this hold/);
    expect(seen.filter((call) => call.url.endsWith('/holds'))).toHaveLength(1);
  });

  it('requires explicit confirmation before the provider can be asked to hold', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    searchBody = { provider: 'Fare Shop', offers: [flightOffer()] };
    const agent = await guestAgent();
    const response = await searchFlight(agent);
    const task = await taskFor(agent, response.body.session.id);

    const refused = await agent
      .post(`/api/tasks/${task.id}/offers/${task.offers[0].id}/hold`)
      .send({});

    expect(refused.status).toBe(400);
    expect(seen).toHaveLength(1); // search only; no hold request reached the provider
  });

  it('does not let another traveler ask a hold on a saved offer', async () => {
    process.env.TRAVELCLAW_FLIGHT_BASE_URL = 'https://fares.example.test';
    process.env.TRAVELCLAW_FLIGHT_API_KEY = 'key';
    searchBody = { provider: 'Fare Shop', offers: [flightOffer()] };
    const owner = await signedInAgent();
    const stranger = await guestAgent();
    const response = await searchFlight(owner);
    const task = await taskFor(owner, response.body.session.id);

    const attempted = await stranger
      .post(`/api/tasks/${task.id}/offers/${task.offers[0].id}/hold`)
      .send({ confirm: true });

    expect(attempted.status).toBe(404);
    expect(seen).toHaveLength(1); // no hold request reached the provider
  });
});
