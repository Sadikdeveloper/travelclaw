import { describe, expect, it } from 'vitest';
import { requestProviderHold, searchFlights } from '../providers';
import type { ConnectorCredentials, ToolContext } from '../types';

const now = new Date('2026-10-06T09:00:00Z');
const KEY = 'fa-secret-key-abcdef123456';

interface Seen {
  url: string;
  headers: Record<string, string>;
  method: string;
}

function ctxWith(
  credentials: ConnectorCredentials,
  respond: (url: string) => Promise<Response>,
  rejected: (name: string) => void = () => {},
): { ctx: ToolContext; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      method: init?.method ?? 'GET',
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
        get: (wanted: string) => (wanted === 'flight' ? credentials : undefined),
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
  providerId: 'flightapi',
  providerName: 'FlightAPI',
  adapter: 'flightapi',
  baseUrl: 'https://api.flightapi.io',
  apiKey: KEY,
  ...extra,
});

const itineraryPayload = {
  itineraries: [
    {
      id: '16216-2404021419--32385-1-12387-2404030005',
      leg_ids: ['leg-1'],
      pricing_options: [
        { price: { amount: 700.5, update_status: 'stale' } },
        { price: { amount: 612.4, update_status: 'current' } },
      ],
    },
    { id: 'no-price-itinerary', leg_ids: ['leg-1'], pricing_options: [] },
  ],
  legs: [
    {
      id: 'leg-1',
      origin_place_id: 1,
      destination_place_id: 2,
      segment_ids: ['seg-1'],
      duration: 330,
      stop_count: 0,
      marketing_carrier_ids: [10],
    },
  ],
  segments: [
    {
      id: 'seg-1',
      origin_place_id: 1,
      destination_place_id: 2,
      departure: '2026-11-02T08:00:00',
      arrival: '2026-11-02T13:30:00',
      marketing_carrier_id: 10,
    },
  ],
  places: [
    { id: 1, code: 'LOS', name: 'Murtala Muhammed International Airport' },
    { id: 2, code: 'LIS', name: 'Humberto Delgado Airport' },
  ],
  carriers: [{ id: 10, name: 'Example Air', code: 'EX' }],
};

describe('FlightAPI.io adapter', () => {
  it('builds the documented one-way path and maps the vendor reference lists', async () => {
    const { ctx, seen } = ctxWith(credential(), async () => json(itineraryPayload));

    const result = await searchFlights(
      { origin: 'LOS', destination: 'LIS', departDate: '2026-11-02', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen).toHaveLength(1);
    // The vendor requires its key in the path; that is the documented exception.
    expect(seen[0].url).toBe(
      `https://api.flightapi.io/onewaytrip/${KEY}/LOS/LIS/2026-11-02/1/0/0/Economy/USD`,
    );
    // No header carries the key — there is no second place for it to leak from.
    expect(seen[0].headers.Authorization).toBeUndefined();

    expect(result.sources[0]).toMatchObject({
      adapter: 'flightapi',
      holdSupport: 'unsupported',
      provider: 'FlightAPI',
    });
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({
      totalAmount: 612.4,
      currency: 'USD',
      holdSupport: 'unsupported',
      hold: 'none',
      providerOfferId: '16216-2404021419--32385-1-12387-2404030005',
    });
    expect(result.offers[0].title).toContain('Example Air');
    expect(result.offers[0].detail).toContain('nonstop');
    expect(result.dropped).toBe(1);
  });

  it('sends a round trip to the round trip path with both dates', async () => {
    const { ctx, seen } = ctxWith(credential(), async () => json(itineraryPayload));

    const result = await searchFlights(
      {
        origin: 'LOS',
        destination: 'LIS',
        departDate: '2026-11-02',
        returnDate: '2026-11-09',
        travelers: 2,
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(seen[0].url).toBe(
      `https://api.flightapi.io/roundtrip/${KEY}/LOS/LIS/2026-11-02/2026-11-09/2/0/0/Economy/USD`,
    );
  });

  it('prices in the stated currency and passes the point of sale, without converting anything', async () => {
    const { ctx, seen } = ctxWith(credential(), async () => json(itineraryPayload));

    const result = await searchFlights(
      {
        origin: 'LOS',
        destination: 'LIS',
        departDate: '2026-11-02',
        travelers: 1,
        currency: 'NGN',
        bookerCountry: 'NG',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen[0].url).toContain('/Economy/NGN');
    expect(seen[0].url).toContain('?region=NG');
    expect(result.offers[0].currency).toBe('NGN');
  });

  it('refuses a city it has no code for instead of guessing an airport', async () => {
    const { ctx, seen } = ctxWith(credential(), async () => json(itineraryPayload));

    const result = await searchFlights(
      { origin: 'Lagos', destination: 'LIS', departDate: '2026-11-02', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('bad_query');
    expect(result.detail).toContain('Lagos');
    expect(seen).toHaveLength(0);
  });

  it('accepts an operator code alias for a city name', async () => {
    const { ctx, seen } = ctxWith(
      credential({ cityCodes: { lagos: 'LOS', lisbon: 'LIS' } }),
      async () => json(itineraryPayload),
    );

    const result = await searchFlights(
      { origin: 'Lagos', destination: 'Lisbon', departDate: '2026-11-02', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(seen[0].url).toContain('/onewaytrip/' + KEY + '/LOS/LIS/');
  });

  it('never returns the path key, even when the vendor echoes the request back in an error', async () => {
    const { ctx } = ctxWith(credential(), async () =>
      json({ error: `Access denied for key ${KEY} on this plan` }),
    );

    const result = await searchFlights(
      { origin: 'LOS', destination: 'LIS', departDate: '2026-11-02', travelers: 1 },
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).not.toContain(KEY);
    expect(result.detail).toContain('[redacted]');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('answers a hold request with the truth: this source does not confirm holds', async () => {
    const { ctx, seen } = ctxWith(credential(), async () => json(itineraryPayload));

    const attempt = await requestProviderHold(
      { kind: 'flight', providerOfferId: 'itinerary-1', providerId: 'flightapi' },
      ctx,
    );

    expect(attempt.confirmed).toBe(false);
    expect(attempt.reason).toBe('unsupported');
    expect(attempt.note).toContain('does not confirm holds');
    // Nothing was sent anywhere: there is no hold endpoint to send it to.
    expect(seen).toHaveLength(0);
  });
});
