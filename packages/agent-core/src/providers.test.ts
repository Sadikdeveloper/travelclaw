import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flightQueryFrom,
  requestProviderHold,
  searchFlights,
  searchStays,
  stayQueryFrom,
} from './providers';
import type { ToolContext } from './types';

const now = new Date('2026-10-02T09:30:00Z');

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Stubbed providers, no real network. `respond` decides what each source returns,
 * so tests can drive offers, empty results, partial failures, and holds.
 */
function ctxWith(
  slot: string,
  credentials: { baseUrl?: string; apiKey?: string } | undefined,
  respond: (url: string, init?: RequestInit) => Promise<Response>,
  rejected: (name: string) => void = () => {},
): { ctx: ToolContext; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return respond(String(url), init);
  }) as typeof fetch;
  return {
    seen,
    ctx: {
      now,
      network: true,
      fetchImpl,
      connectors: {
        get: (wanted: string) => (wanted === slot ? credentials : undefined),
        rejected,
      },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const FLIGHT_QUERY = {
  origin: 'Lagos',
  destination: 'Lisbon',
  departDate: '2026-11-02',
  travelers: 2,
};

const STAY_QUERY = {
  destination: 'Lisbon',
  checkIn: '2026-11-02',
  checkOut: '2026-11-06',
  travelers: 2,
};

describe('flight search', () => {
  it('returns the provider offers, naming the provider and the retrieval time', async () => {
    const { ctx, seen } = ctxWith(
      'flight',
      { baseUrl: 'https://fares.example.com/', apiKey: 'sk-fares-1234' },
      async () =>
        json({
          provider: 'Fare Shop',
          offers: [
            {
              id: 'TP-1020',
              price: { amount: '182.40', currency: 'eur' },
              segments: [
                {
                  from: 'LOS',
                  to: 'LIS',
                  departAt: '2026-11-02T10:20Z',
                  arriveAt: '2026-11-02T15:05Z',
                  carrier: 'TP',
                },
              ],
            },
            {
              id: 'ZZ-0640',
              price: { amount: 241, currency: 'EUR' },
              title: 'Two legs through Casablanca',
              hold: { confirmed: true, ref: 'HOLD-9', expiresAt: '2026-10-02T18:00Z' },
            },
          ],
        }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      provider: 'Fare Shop',
      retrievedAt: '2026-10-02T09:30:00.000Z',
    });
    expect(result.offers).toHaveLength(2);
    expect(result.offers[0]).toMatchObject({
      provider: 'Fare Shop',
      providerId: 'flight-1',
      retrievedAt: '2026-10-02T09:30:00.000Z',
    });
    expect(result.offers[0]).toMatchObject({
      providerOfferId: 'TP-1020',
      title: 'TP: LOS → LIS',
      currency: 'EUR',
      totalAmount: 182.4,
      hold: 'none',
    });
    expect(result.offers[0].detail).toMatch(/nonstop/);
    // The same vendor facts, kept structured so the card can draw a fare row.
    expect(result.offers[0].facts).toEqual({
      kind: 'flight',
      segments: [
        {
          from: 'LOS',
          to: 'LIS',
          departAt: '2026-11-02T10:20Z',
          arriveAt: '2026-11-02T15:05Z',
          carrier: 'TP',
        },
      ],
      stops: 0,
      durationMinutes: null,
      stopNames: [],
    });
    // An offer with no vendor segment data has no facts to draw: prose only.
    expect(result.offers[1].facts).toBeNull();
    // A hold is reported because the provider confirmed one with a reference.
    expect(result.offers[1].hold).toBe('confirmed');
    expect(result.offers[1].holdRef).toBe('HOLD-9');

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(
      'https://fares.example.com/search/flights?origin=Lagos&destination=Lisbon&departDate=2026-11-02&travelers=2',
    );
    // The key travels in a header only: not in the URL, not in the offers.
    expect(seen[0].headers.Authorization).toBe('Bearer sk-fares-1234');
    expect(seen[0].url).not.toContain('sk-fares-1234');
    expect(JSON.stringify(result)).not.toContain('sk-fares-1234');
  });

  it('never turns a multi-leg itinerary into a stop count of its own', async () => {
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () =>
        json({
          offers: [
            {
              id: 'round-trip-nonstop',
              price: { amount: 400, currency: 'EUR' },
              // Two legs is a return journey, not one connection. Without the
              // vendor's own count the desk says nothing about stops.
              segments: [
                { from: 'LOS', to: 'LIS', carrier: 'TP' },
                { from: 'LIS', to: 'LOS', carrier: 'TP' },
              ],
            },
          ],
        }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = result.offers[0].facts;
    expect(facts?.kind).toBe('flight');
    if (facts?.kind !== 'flight') return;
    expect(facts.stops).toBeNull();
    expect(facts.stopNames).toEqual([]);
  });

  it('keeps a vendor stop count and its layover names when both are sent', async () => {
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () =>
        json({
          offers: [
            {
              id: 'via-lagos',
              price: { amount: 222174, currency: 'NGN' },
              stops: 1,
              durationMinutes: 1440,
              stopNames: ['Lagos'],
              segments: [
                {
                  from: 'KAN',
                  to: 'LOS',
                  departAt: '2026-10-12 20:05',
                  carrier: 'Air Peace',
                },
                {
                  from: 'LOS',
                  to: 'ABV',
                  departAt: '2026-10-12 22:10',
                  carrier: 'Air Peace',
                },
              ],
            },
          ],
        }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = result.offers[0].facts;
    expect(facts?.kind).toBe('flight');
    if (facts?.kind !== 'flight') return;
    expect(facts.stops).toBe(1);
    expect(facts.durationMinutes).toBe(1440);
    expect(facts.stopNames).toEqual(['Lagos']);
  });

  it('drops a stop count that cannot be squared with the named stops', async () => {
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () =>
        json({
          offers: [
            {
              id: 'two-stops',
              price: { amount: 300, currency: 'EUR' },
              stops: 2,
              // Only one place named: the desk keeps the count and drops the name
              // rather than attributing it to the wrong connection.
              stopNames: ['Lagos'],
              segments: [
                { from: 'KAN', to: 'LOS', carrier: 'Air Peace' },
                { from: 'LOS', to: 'ABV', carrier: 'Air Peace' },
              ],
            },
          ],
        }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = result.offers[0].facts;
    expect(facts?.kind).toBe('flight');
    if (facts?.kind !== 'flight') return;
    expect(facts.stops).toBe(2);
    expect(facts.stopNames).toEqual([]);
  });

  it('drops an offer the provider did not price instead of inventing one', async () => {
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () =>
        json({
          offers: [
            { id: 'no-price', segments: [{ from: 'LOS', to: 'LIS' }] },
            { id: 'priced', price: { amount: 99.5, currency: 'USD' } },
          ],
        }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offers.map((offer) => offer.providerOfferId)).toEqual(['priced']);
    expect(result.dropped).toBe(1);
    // The unnamed provider falls back to the connector host, not to a guess.
    expect(result.sources[0].provider).toBe('f.example');
  });

  it('reports an empty result as an empty result', async () => {
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () => json({ provider: 'Fare Shop', offers: [] }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result).toMatchObject({
      ok: true,
      offers: [],
      sources: [{ provider: 'Fare Shop' }],
    });
  });

  it('keeps the provider order and caps the offers shown per search', async () => {
    const offers = Array.from({ length: 8 }, (_, index) => ({
      id: `F-${index}`,
      price: { amount: 100 + index + 0.005, currency: 'USD' },
    }));
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () => json({ offers }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offers).toHaveLength(6);
    expect(result.offers.map((offer) => offer.providerOfferId)).toEqual([
      'F-0',
      'F-1',
      'F-2',
      'F-3',
      'F-4',
      'F-5',
    ]);
    expect(result.limited).toBe(2);
    expect(result.dropped).toBe(0);
    expect(result.offers[0].totalAmount).toBe(100.005);
  });

  it('reports a provider error rather than a plausible-looking list', async () => {
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () => json({ error: 'upstream' }, 502),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('http_error');
    expect(result.detail).toContain('502');
  });

  it('marks the connector rejected on a 401', async () => {
    const rejected = vi.fn();
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'bad-key', baseUrl: 'https://f.example' },
      async () => json({ error: 'nope' }, 401),
      rejected,
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(rejected).toHaveBeenCalledWith('flight');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unauthorized');
  });

  it('reports a network failure rather than a plausible-looking list', async () => {
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () => {
        throw new Error('connection refused');
      },
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result).toMatchObject({ ok: false, reason: 'network_error' });
  });

  it('stops waiting when a provider exceeds the request timeout', async () => {
    vi.useFakeTimers();
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const pending = searchFlights(FLIGHT_QUERY, ctx);
    await vi.advanceTimersByTimeAsync(9000);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a payload that is not an offer list', async () => {
    const { ctx } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () => json({ flights: 'soon' }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result).toMatchObject({ ok: false, reason: 'bad_payload' });
  });

  it('calls nothing at all when the operator set no key', async () => {
    const { ctx, seen } = ctxWith('flight', undefined, async () => json({ offers: [] }));

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result).toMatchObject({ ok: false, reason: 'no_key' });
    expect(seen).toHaveLength(0);
  });

  it('calls nothing when a key is set without a reachable base URL', async () => {
    const { ctx, seen } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'file:///etc/passwd' },
      async () => json({ offers: [] }),
    );

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result).toMatchObject({ ok: false, reason: 'no_base_url' });
    expect(seen).toHaveLength(0);
  });

  it('calls nothing when the desk has network access switched off', async () => {
    const { ctx, seen } = ctxWith(
      'flight',
      { apiKey: 'k', baseUrl: 'https://f.example' },
      async () => json({ offers: [] }),
    );
    ctx.network = false;

    const result = await searchFlights(FLIGHT_QUERY, ctx);
    expect(result).toMatchObject({ ok: false, reason: 'no_key' });
    expect(seen).toHaveLength(0);
  });

  it('fans out to multiple regional sources and interleaves their ranked offers', async () => {
    const { ctx, seen } = ctxWith('flight', undefined, async (url) => {
      const host = new URL(url).host;
      if (host === 'global-fares.example') {
        return json({
          provider: 'Global Fares',
          offers: [
            { id: 'G-1', price: { amount: 180, currency: 'USD' } },
            { id: 'G-2', price: { amount: 190, currency: 'USD' } },
          ],
        });
      }
      return json({
        provider: 'West Africa Fares',
        offers: [
          { id: 'W-1', price: { amount: 170, currency: 'NGN' } },
          { id: 'W-2', price: { amount: 175, currency: 'NGN' } },
        ],
      });
    });
    ctx.connectors!.all = (name) =>
      name === 'flight'
        ? [
            {
              providerId: 'global',
              baseUrl: 'https://global-fares.example',
              apiKey: 'global-secret',
            },
            {
              providerId: 'west-africa',
              providerName: 'West Africa Fares',
              baseUrl: 'https://regional-fares.example',
              apiKey: 'regional-secret',
            },
          ]
        : [];

    const result = await searchFlights(FLIGHT_QUERY, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offers.map((offer) => offer.providerOfferId)).toEqual([
      'G-1',
      'W-1',
      'G-2',
      'W-2',
    ]);
    expect(result.offers.map((offer) => offer.provider)).toEqual([
      'Global Fares',
      'West Africa Fares',
      'Global Fares',
      'West Africa Fares',
    ]);
    expect(result.sources.map((source) => source.providerId)).toEqual([
      'global',
      'west-africa',
    ]);
    expect(seen).toHaveLength(2);
    expect(seen.map((call) => call.headers.Authorization)).toEqual([
      'Bearer global-secret',
      'Bearer regional-secret',
    ]);
    expect(seen.every((call) => !call.url.includes('secret'))).toBe(true);
  });

  it('keeps successful regional results when another provider errors', async () => {
    const { ctx } = ctxWith('flight', undefined, async (url) => {
      if (new URL(url).host === 'down.example') return json({}, 503);
      return json({ provider: 'Available Source', offers: [] });
    });
    ctx.connectors!.all = (name) =>
      name === 'flight'
        ? [
            { providerId: 'down', baseUrl: 'https://down.example', apiKey: 'down-key' },
            { providerId: 'up', baseUrl: 'https://up.example', apiKey: 'up-key' },
          ]
        : [];

    const result = await searchFlights(FLIGHT_QUERY, ctx);

    expect(result).toMatchObject({
      ok: true,
      offers: [],
      sources: [
        { providerId: 'down', ok: false, reason: 'http_error' },
        { providerId: 'up', ok: true, provider: 'Available Source' },
      ],
    });
  });
});

describe('stay search', () => {
  it('asks for the dates and the party, and reads the room the provider named', async () => {
    const { ctx, seen } = ctxWith(
      'stay',
      { apiKey: 'sk-stay-7', baseUrl: 'https://beds.example' },
      async () =>
        json({
          provider: 'Bed Book',
          offers: [
            {
              id: 'casa-1',
              price: { amount: 412.8, currency: 'EUR' },
              stay: { name: 'Casa do Rio', roomType: 'double', nights: 4, rating: 8.6 },
            },
          ],
        }),
    );

    const result = await searchStays(STAY_QUERY, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offers[0].title).toBe('Casa do Rio');
    expect(result.offers[0].detail).toMatch(/double · 4 nights/);
    expect(seen[0].url).toBe(
      'https://beds.example/search/stays?destination=Lisbon&checkIn=2026-11-02&checkOut=2026-11-06&travelers=2',
    );
    expect(seen[0].headers.Authorization).toBe('Bearer sk-stay-7');
  });

  it('treats a provider claim of "held" without a reference as no hold at all', async () => {
    const { ctx } = ctxWith(
      'stay',
      { apiKey: 'k', baseUrl: 'https://beds.example' },
      async () =>
        json({
          offers: [
            { id: 'a', price: { amount: 100, currency: 'EUR' }, hold: { requested: true } },
            { id: 'b', price: { amount: 110, currency: 'EUR' }, hold: { confirmed: true } },
            { id: 'c', price: { amount: 120, currency: 'EUR' }, hold: true },
          ],
        }),
    );

    const result = await searchStays(STAY_QUERY, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const offer of result.offers) {
      expect(offer.hold).toBe('none');
      expect(offer.holdRef).toBeNull();
      expect(offer.holdNote).toMatch(/stays an offer/);
    }
  });
});

describe('hold requests', () => {
  it('reports a hold only when the provider confirms one with a reference', async () => {
    const { ctx, seen } = ctxWith(
      'flight',
      { apiKey: 'sk-fares-1', baseUrl: 'https://f.example' },
      async () => json({ confirmed: true, ref: 'HOLD-42', expiresAt: '2026-10-02T18:00Z' }),
    );

    const result = await requestProviderHold(
      { kind: 'flight', providerOfferId: 'TP-1020' },
      ctx,
    );
    expect(result).toMatchObject({ confirmed: true, ref: 'HOLD-42' });
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('https://f.example/holds');
    expect(seen[0].body).toBe(JSON.stringify({ kind: 'flight', offerId: 'TP-1020' }));
  });

  it('does not claim a hold the provider did not confirm', async () => {
    const answers: unknown[] = [
      { confirmed: false, reason: 'sold out' },
      { confirmed: true },
      { status: 'hold_requested' },
      { hold: 'HOLD-42' },
    ];
    for (const answer of answers) {
      const { ctx } = ctxWith(
        'flight',
        { apiKey: 'k', baseUrl: 'https://f.example' },
        async () => json(answer),
      );
      const result = await requestProviderHold(
        { kind: 'flight', providerOfferId: 'TP-1020' },
        ctx,
      );
      expect(result.confirmed, JSON.stringify(answer)).toBe(false);
      expect(result.ref).toBeNull();
      expect(result.note).toMatch(/still an offer/);
    }
  });

  it('reports no hold when the provider errors, hangs, or refuses the key', async () => {
    const cases: Array<{
      respond: () => Promise<Response>;
      reason: string;
      rejected?: boolean;
    }> = [
      {
        respond: async () => json({ confirmed: true, ref: 'x' }, 500),
        reason: 'http_error',
      },
      {
        respond: async () => {
          throw new Error('hang');
        },
        reason: 'network_error',
      },
      {
        respond: async () => json({}, 403),
        reason: 'unauthorized',
        rejected: true,
      },
    ];
    for (const testCase of cases) {
      const rejected = vi.fn();
      const { ctx } = ctxWith(
        'stay',
        { apiKey: 'k', baseUrl: 'https://beds.example' },
        testCase.respond,
        rejected,
      );
      const result = await requestProviderHold(
        { kind: 'stay', providerOfferId: 'casa-1' },
        ctx,
      );
      expect(result.confirmed, testCase.reason).toBe(false);
      expect(result.reason, testCase.reason).toBe(testCase.reason);
      if (testCase.rejected) expect(rejected).toHaveBeenCalledWith('stay');
    }
  });

  it('never calls a provider that is not configured', async () => {
    const { ctx, seen } = ctxWith('stay', undefined, async () =>
      json({ confirmed: true, ref: 'x' }),
    );
    const result = await requestProviderHold(
      { kind: 'stay', providerOfferId: 'casa-1' },
      ctx,
    );
    expect(result.confirmed).toBe(false);
    expect(result.reason).toBe('no_key');
    expect(seen).toHaveLength(0);
  });

  it('routes a hold to the exact source that returned the selected offer', async () => {
    const { ctx, seen } = ctxWith('flight', undefined, async () =>
      json({ confirmed: true, ref: 'REGION-HOLD' }),
    );
    ctx.connectors!.all = (name) =>
      name === 'flight'
        ? [
            {
              providerId: 'global',
              baseUrl: 'https://global-fares.example',
              apiKey: 'global-key',
            },
            {
              providerId: 'regional',
              baseUrl: 'https://regional-fares.example',
              apiKey: 'regional-key',
            },
          ]
        : [];

    const result = await requestProviderHold(
      {
        kind: 'flight',
        providerOfferId: 'regional-offer',
        providerId: 'regional',
        providerBaseUrl: 'https://regional-fares.example',
      },
      ctx,
    );

    expect(result).toMatchObject({ confirmed: true, ref: 'REGION-HOLD' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://regional-fares.example/holds');
    expect(seen[0].headers.Authorization).toBe('Bearer regional-key');
  });

  it('will not send an old offer id to a newly configured provider', async () => {
    const { ctx, seen } = ctxWith(
      'flight',
      { apiKey: 'new-key', baseUrl: 'https://new-fares.example' },
      async () => json({ confirmed: true, ref: 'wrong-provider' }),
    );

    const result = await requestProviderHold(
      {
        kind: 'flight',
        providerOfferId: 'old-offer',
        providerBaseUrl: 'https://old-fares.example',
      },
      ctx,
    );

    expect(result).toMatchObject({ confirmed: false, reason: 'provider_changed' });
    expect(result.note).toMatch(/provider changed since this offer was retrieved/);
    expect(seen).toHaveLength(0);
  });
});

describe('reading a search out of the traveler’s own words', () => {
  it('takes the route and dates from a plain request', () => {
    const draft = flightQueryFrom('Find a flight from Lagos to Lisbon on 2026-11-02', {
      origin: 'Lagos',
      destination: 'Lisbon',
      startDate: '2026-11-02',
      interests: [],
    });
    expect(draft.missing).toEqual([]);
    expect(draft.query).toEqual({
      origin: 'Lagos',
      destination: 'Lisbon',
      departDate: '2026-11-02',
      travelers: 1,
    });
  });

  it('names a city the desk has no card for instead of dropping the search', () => {
    const draft = flightQueryFrom('Fly LOS to ACC on 2026-12-01', {
      startDate: '2026-12-01',
      interests: [],
    });
    expect(draft.query).toMatchObject({ origin: 'LOS', destination: 'ACC' });
  });

  it('treats a second date as a return only when it is later', () => {
    const later = flightQueryFrom('Lagos to Lisbon from 2026-11-02 to 2026-11-09', {
      origin: 'Lagos',
      destination: 'Lisbon',
      startDate: '2026-11-02',
      endDate: '2026-11-09',
      interests: [],
    });
    expect(later.query?.returnDate).toBe('2026-11-09');

    const sameDay = flightQueryFrom('Lagos to Lisbon on 2026-11-02', {
      origin: 'Lagos',
      destination: 'Lisbon',
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      interests: [],
    });
    expect(sameDay.query?.returnDate).toBeUndefined();

    // Itinerary hints can infer an end date from trip length, but that is not
    // enough evidence to quietly request a return fare.
    const inferred = flightQueryFrom('Lagos to Lisbon for 4 days on 2026-11-02', {
      origin: 'Lagos',
      destination: 'Lisbon',
      startDate: '2026-11-02',
      endDate: '2026-11-05',
      days: 4,
      interests: [],
    });
    expect(inferred.query?.returnDate).toBeUndefined();
  });

  it('says what is missing rather than searching for nothing', () => {
    const draft = flightQueryFrom('Find me a flight', { interests: [] });
    expect(draft.query).toBeUndefined();
    expect(draft.missing).toEqual(['an origin city', 'a destination', 'a departure date']);
  });

  it('refuses a month name that follows a preposition', () => {
    const draft = stayQueryFrom('A hotel in November for 2', {
      startDate: '2026-11-02',
      endDate: '2026-11-06',
      travelers: 2,
      interests: [],
    });
    expect(draft.query).toBeUndefined();
    expect(draft.missing).toContain('a city');
  });

  it('reads the party and the nights out of a stay request', () => {
    const draft = stayQueryFrom(
      'Book a hotel in Lisbon for 2 from 2026-11-02 to 2026-11-06',
      {
        destination: 'Lisbon',
        startDate: '2026-11-02',
        endDate: '2026-11-06',
        travelers: 2,
        interests: [],
      },
    );
    expect(draft.query).toEqual({
      destination: 'Lisbon',
      checkIn: '2026-11-02',
      checkOut: '2026-11-06',
      travelers: 2,
    });
  });

  it('asks for a check-out date when only one date arrived', () => {
    const draft = stayQueryFrom('A hotel in Lisbon on 2026-11-02', {
      destination: 'Lisbon',
      startDate: '2026-11-02',
      interests: [],
    });
    expect(draft.missing).toEqual(['a check-out date after check-in']);
  });

  it('derives a stay check-out from an explicit night count', () => {
    const draft = stayQueryFrom('A hotel in Lisbon for 4 nights from 2026-11-02', {
      destination: 'Lisbon',
      startDate: '2026-11-02',
      interests: [],
    });
    expect(draft.query).toMatchObject({
      destination: 'Lisbon',
      checkIn: '2026-11-02',
      checkOut: '2026-11-06',
    });
  });
});
