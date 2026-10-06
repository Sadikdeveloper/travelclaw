import { describe, expect, it } from 'vitest';
import { searchFlights, searchStays } from '../providers';
import type { ConnectorCredentials, ToolContext } from '../types';
import { serpapiAdapter } from './serpapi';

const now = new Date('2026-10-06T09:00:00Z');

interface Seen {
  url: string;
  headers: Record<string, string>;
}

function ctxWith(
  slot: 'flight' | 'stay',
  credentials: ConnectorCredentials,
  respond: (url: string) => Promise<Response>,
  rejected: (name: string) => void = () => {},
): { ctx: ToolContext; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return respond(String(url));
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

const credential = (extra: Partial<ConnectorCredentials> = {}): ConnectorCredentials => ({
  providerId: 'serpapi',
  providerName: 'SerpApi',
  adapter: 'serpapi',
  baseUrl: 'https://serpapi.com',
  apiKey: 'serp-key-abcdef',
  ...extra,
});

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
      booking_token: 'opaque-booking-token',
    },
  ],
  other_flights: [
    {
      flights: [
        {
          departure_airport: {
            name: 'Murtala Muhammed',
            id: 'LOS',
            time: '2026-11-02 20:00',
          },
          arrival_airport: {
            name: 'Humberto Delgado',
            id: 'LIS',
            time: '2026-11-03 03:30',
          },
          airline: 'Second Air',
          flight_number: 'SA 9',
        },
      ],
      price: 705,
    },
  ],
};

describe('SerpApi Google Flights adapter', () => {
  it('resolves a city with the vendor lookup, keeps the key in a header, and maps real fares', async () => {
    const { ctx, seen } = ctxWith('flight', credential(), async (url) =>
      url.includes('google_flights_autocomplete')
        ? json({
            suggestions: [{ name: 'Lisbon', id: '/m/04jpl', airports: [{ id: 'LIS' }] }],
          })
        : json(flightsPayload),
    );

    const result = await searchFlights(
      { origin: 'LOS', destination: 'Lisbon', departDate: '2026-11-02', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toHaveLength(2);
    expect(seen[0].url).toContain('engine=google_flights_autocomplete');
    expect(seen[0].url).toContain('q=Lisbon');
    expect(seen[1].url).toContain('engine=google_flights');
    expect(seen[1].url).toContain('departure_id=LOS');
    expect(seen[1].url).toContain('arrival_id=%2Fm%2F04jpl');
    expect(seen[1].url).toContain('type=2');
    expect(
      seen.every((call) => call.headers.Authorization === 'Bearer serp-key-abcdef'),
    ).toBe(true);
    expect(seen.every((call) => !call.url.includes('serp-key-abcdef'))).toBe(true);

    expect(result.sources[0]).toMatchObject({
      adapter: 'serpapi',
      holdSupport: 'unsupported',
      ok: true,
    });
    expect(result.offers).toHaveLength(2);
    expect(result.offers[0]).toMatchObject({
      providerOfferId: expect.any(String),
      currency: 'EUR',
      totalAmount: 620.5,
      provider: 'SerpApi',
      adapter: 'serpapi',
      holdSupport: 'unsupported',
      hold: 'none',
    });
    expect(result.offers[0].title).toContain('Example Air');
    expect(result.offers[0].detail).toContain('nonstop');
    // The vendor's own booking token is not stored as the offer id.
    expect(result.offers[0].providerOfferId).not.toContain('opaque-booking-token');
  });

  it('passes an airport code straight through without a lookup call', async () => {
    const { ctx, seen } = ctxWith('flight', credential(), async () => json(flightsPayload));

    const result = await searchFlights(
      { origin: 'LOS', destination: 'LIS', departDate: '2026-11-02', travelers: 2 },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain('adults=2');
    // Nothing in the message stated a currency, so the desk does not invent one;
    // the vendor's own default (USD) is what it then prices in.
    expect(seen[0].url).not.toContain('currency=');
    expect(result.offers[0].currency).toBe('EUR');
  });

  it('uses an operator alias before asking the vendor to resolve a city', async () => {
    const { ctx, seen } = ctxWith(
      'flight',
      credential({ cityCodes: { lagos: 'LOS' } }),
      async () => json(flightsPayload),
    );

    const result = await searchFlights(
      { origin: 'Lagos', destination: 'LIS', departDate: '2026-11-02', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain('departure_id=LOS');
  });

  it('refuses the search instead of guessing an airport for a city the vendor does not know', async () => {
    const { ctx } = ctxWith('flight', credential(), async (url) =>
      url.includes('autocomplete') ? json({ suggestions: [] }) : json(flightsPayload),
    );

    const result = await searchFlights(
      {
        origin: 'Nowhereville',
        destination: 'LIS',
        departDate: '2026-11-02',
        travelers: 1,
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('bad_query');
    expect(result.detail).toContain('Nowhereville');
  });

  it('reports a vendor error body instead of an empty search', async () => {
    const { ctx } = ctxWith('flight', credential(), async (url) =>
      url.includes('autocomplete')
        ? json({ suggestions: [{ id: '/m/04jpl' }] })
        : json({ error: 'Your account has run out of searches.' }),
    );

    const result = await searchFlights(
      { origin: 'LOS', destination: 'Lisbon', departDate: '2026-11-02', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('run out of searches');
  });

  it('keeps the vendor stop count, layover name, and total duration as facts', async () => {
    const { ctx } = ctxWith('flight', credential(), async () =>
      json({
        search_parameters: { engine: 'google_flights', currency: 'NGN' },
        best_flights: [
          {
            flights: [
              {
                departure_airport: { id: 'KAN', time: '2026-10-12 20:05' },
                arrival_airport: { id: 'LOS', time: '2026-10-12 21:20' },
                airline: 'Air Peace',
                flight_number: 'P4 7121',
              },
              {
                departure_airport: { id: 'LOS', time: '2026-10-12 22:10' },
                arrival_airport: { id: 'ABV', time: '2026-10-13 23:50' },
                airline: 'Air Peace',
                flight_number: 'P4 7130',
              },
            ],
            total_duration: 1440,
            price: 222174,
            layovers: [{ name: 'Lagos', id: 'LOS', duration: 50 }],
          },
        ],
      }),
    );

    const result = await searchFlights(
      { origin: 'KAN', destination: 'ABV', departDate: '2026-10-12', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = result.offers[0].facts;
    expect(facts?.kind).toBe('flight');
    if (facts?.kind !== 'flight') return;
    expect(facts.stops).toBe(1);
    expect(facts.durationMinutes).toBe(1440);
    expect(facts.stopNames).toEqual(['Lagos']);
    expect(facts.segments).toHaveLength(2);
  });

  it('names the source from the adapter when the operator did not label it', async () => {
    const { ctx } = ctxWith('flight', credential({ providerName: undefined }), async () =>
      json(flightsPayload),
    );

    const result = await searchFlights(
      { origin: 'LOS', destination: 'LIS', departDate: '2026-11-02', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources[0].provider).toBe('SerpApi Google Flights and Hotels');
    expect(serpapiAdapter.slots).toContain('stay');
  });
});

describe('SerpApi Google Hotels adapter', () => {
  const hotelsPayload = {
    search_parameters: { engine: 'google_hotels', currency: 'MYR' },
    properties: [
      {
        name: 'Harbour View Hotel',
        property_token: 'hotel-token-1',
        rate_per_night: { lowest: 'MYR 528', extracted_lowest: 528 },
        total_rate: { lowest: 'MYR 1,584', extracted_lowest: 1584 },
        overall_rating: 4.3,
      },
      {
        name: 'Nightly Only Inn',
        property_token: 'hotel-token-2',
        rate_per_night: { lowest: 'MYR 200', extracted_lowest: 200 },
      },
      { name: 'View Prices Later', property_token: 'hotel-token-3' },
    ],
  };

  it('uses the vendor total, multiplies only a nightly rate, and drops an unpriced property', async () => {
    const { ctx, seen } = ctxWith('stay', credential(), async () => json(hotelsPayload));

    const result = await searchStays(
      { destination: 'Bali', checkIn: '2026-11-02', checkOut: '2026-11-05', travelers: 2 },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen[0].url).toContain('engine=google_hotels');
    expect(seen[0].url).toContain('q=Bali');
    expect(seen[0].url).toContain('check_in_date=2026-11-02');
    expect(seen[0].url).toContain('check_out_date=2026-11-05');
    expect(seen[0].url).toContain('adults=2');

    expect(result.offers.map((offer) => offer.providerOfferId)).toEqual([
      'hotel-token-1',
      'hotel-token-2',
    ]);
    expect(result.offers[0]).toMatchObject({
      title: 'Harbour View Hotel',
      currency: 'MYR',
      totalAmount: 1584,
      holdSupport: 'unsupported',
    });
    expect(result.offers[0].detail).toContain('4.3');
    // No total was sent for this one, so three nights are the nights asked for.
    expect(result.offers[1].totalAmount).toBe(600);
    expect(result.dropped).toBe(1);
  });

  it('labels a symbol-only price with the currency the vendor said it used', async () => {
    const { ctx } = ctxWith('stay', credential(), async () =>
      json({
        search_parameters: { currency: 'USD' },
        properties: [
          {
            name: 'Symbol Hotel',
            property_token: 'tok',
            total_rate: { lowest: '$300', extracted_lowest: 300 },
          },
        ],
      }),
    );

    const result = await searchStays(
      {
        destination: 'Austin',
        checkIn: '2026-11-02',
        checkOut: '2026-11-04',
        travelers: 1,
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offers[0].currency).toBe('USD');
  });
});

describe('SerpApi credential placement', () => {
  const query = {
    origin: 'LOS',
    destination: 'LIS',
    departDate: '2026-11-02',
    travelers: 1,
  };

  const result = {
    search_parameters: { engine: 'google_flights', currency: 'USD' },
    best_flights: [
      { flights: [{ airline: 'TAP Air Portugal', flight_number: 'TP 1522' }], price: 640 },
    ],
  };

  it('sends the key as a header when the vendor accepts it', async () => {
    const { ctx, seen } = ctxWith('flight', credential(), async () => json(result));
    const outcome = await searchFlights(query, ctx);

    expect(outcome.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.Authorization).toBe('Bearer serp-key-abcdef');
    expect(seen[0].url).not.toContain('serp-key-abcdef');
    expect(seen[0].url).not.toContain('api_key');
  });

  it('retries with api_key in the query, once, when the header is refused', async () => {
    const { ctx, seen } = ctxWith(
      'flight',
      credential({ apiKey: 'serp-key-fallback' }),
      async (url) =>
        url.includes('api_key=serp-key-fallback')
          ? json(result)
          : json({ error: 'Invalid API key' }, 401),
    );

    const outcome = await searchFlights(query, ctx);
    expect(outcome.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0].headers.Authorization).toBe('Bearer serp-key-fallback');
    expect(seen[1].url).toContain('api_key=serp-key-fallback');

    // Every string the desk hands back is scrubbed, even in the fallback.
    expect(JSON.stringify(outcome)).not.toContain('serp-key-fallback');
  });

  it('remembers a refused header for that source, so the next search pays one call', async () => {
    const { ctx, seen } = ctxWith(
      'flight',
      credential({ apiKey: 'serp-key-learned' }),
      async (url) =>
        url.includes('api_key=serp-key-learned')
          ? json(result)
          : json({ error: 'Invalid API key' }, 401),
    );

    expect((await searchFlights(query, ctx)).ok).toBe(true);
    expect(seen).toHaveLength(2);

    expect((await searchFlights(query, ctx)).ok).toBe(true);
    expect(seen).toHaveLength(3);
    expect(seen[2].url).toContain('api_key=serp-key-learned');
    expect(seen[2].headers.Authorization).toBeUndefined();
  });

  it('reports a refusal as unauthorized when both placements are refused', async () => {
    const rejections: string[] = [];
    const { ctx, seen } = ctxWith(
      'flight',
      credential({ apiKey: 'serp-key-refused' }),
      async () => json({ error: 'Invalid API key' }, 401),
      (name) => rejections.push(name),
    );

    const outcome = await searchFlights(query, ctx);
    expect(seen).toHaveLength(2);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unauthorized');
    expect(JSON.stringify(outcome)).not.toContain('serp-key-refused');
    expect(rejections).toEqual(['flight']);
  });
});
