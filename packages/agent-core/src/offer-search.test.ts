import { describe, expect, it } from 'vitest';
import { assemblePrompt } from './prompt';
import { mergeHints } from './tool-calls';
import { findTool, routeTools, runTool, toolSpecs } from './tools';
import { completeTurn, mockProvider } from './turn';
import type {
  ConnectorCredentials,
  HistoryTurn,
  ModelCompletion,
  ModelProvider,
  ToolContext,
  TripHints,
  TurnRequest,
} from './types';

/**
 * The fare tools are the desk's answer to "how much is the flight". These tests
 * hold the line the traveler cares about: a price comes from a vendor adapter
 * (SerpApi, FlightAPI.io, or the operator's own contract) or the desk says it has
 * no price. A web page never stands in for one.
 */

const now = new Date('2026-10-07T09:00:00Z');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface Stub {
  ctx: ToolContext;
  calls: Array<{ url: string; authorization?: string }>;
}

function stub(
  slot: 'flight' | 'stay',
  credentials: ConnectorCredentials[],
  respond: (call: { url: string; authorization?: string }) => Promise<Response>,
): Stub {
  const calls: Stub['calls'] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call = { url: String(url), authorization: headers.Authorization };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return {
    calls,
    ctx: {
      now,
      network: true,
      fetchImpl,
      connectors: {
        get: (wanted: string) => (wanted === slot ? credentials[0] : undefined),
        all: (wanted: string) => (wanted === slot ? credentials : []),
      },
    },
  };
}

const serpapi = (extra: Partial<ConnectorCredentials> = {}): ConnectorCredentials => ({
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
          departure_airport: { id: 'LOS', time: '2026-11-03 08:00' },
          arrival_airport: { id: 'LIS', time: '2026-11-03 15:30' },
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
          departure_airport: { id: 'LOS', time: '2026-11-03 20:00' },
          arrival_airport: { id: 'LIS', time: '2026-11-04 03:30' },
          airline: 'Second Air',
        },
      ],
      price: 705,
    },
  ],
};

/** SerpApi resolves a city it was given by name before it prices a route. */
function respondFlights({ url }: { url: string }): Promise<Response> {
  return Promise.resolve(
    url.includes('google_flights_autocomplete')
      ? json({
          suggestions: [{ name: 'Lisbon', id: '/m/04jpl', airports: [{ id: 'LIS' }] }],
        })
      : json(flightsPayload),
  );
}

const hotelsPayload = {
  search_parameters: { engine: 'google_hotels', currency: 'EUR' },
  properties: [
    {
      name: 'Harbour View Hotel',
      property_token: 'hotel-token-1',
      total_rate: { lowest: 'EUR 1,584', extracted_lowest: 1584 },
      overall_rating: 4.3,
    },
    { name: 'View Prices Later', property_token: 'hotel-token-3' },
  ],
};

function request(text: string, history: HistoryTurn[] = []): TurnRequest {
  return {
    text,
    persona: { name: 'Marlow', soul: 'Be brief.', identity: '', user: '', agents: '' },
    memory: [],
    history,
  };
}

/**
 * The hints a call really arrives with: the router's own read of the traveler's
 * text, with a model's arguments winning where it sent any. Calling a tool with
 * bare hints instead would test a path no caller takes.
 */
function hints(text: string, fromModel: Partial<TripHints> = {}): TripHints {
  return mergeHints(text, fromModel);
}

describe('the fare tools the model is given', () => {
  it('puts fares and rooms in the catalog, and marks the web as not a price source', () => {
    const names = toolSpecs().map((tool) => tool.name);
    expect(names).toContain('flights.search');
    expect(names).toContain('stays.search');
    const web = toolSpecs().find((tool) => tool.name === 'web.search');
    expect(web?.description).toMatch(/not a price source/i);
    const flights = toolSpecs().find((tool) => tool.name === 'flights.search');
    expect(Object.keys(flights?.parameters.properties ?? {})).toEqual([
      'origin',
      'destination',
      'departDate',
      'departMonth',
      'returnDate',
      'travelers',
    ]);
  });

  it('tells the model where a price may come from', () => {
    const prompt = assemblePrompt(request('How much is a flight to Lisbon?'), []);
    expect(prompt).toMatch(/Fares come only from flights\.search/);
    expect(prompt).toMatch(/never a fare or a rate/i);
  });
});

describe('router', () => {
  it('sends a fare question to the fare tool, not to the web', () => {
    const names = routeTools('Find me a flight from Lagos to Lisbon on 2026-11-03');
    expect(names[0]).toBe('flights.search');
    expect(names).not.toContain('web.search');
  });

  it('sends a hotel question to the stay tool, not to the web', () => {
    const names = routeTools(
      'I need a hotel in Lisbon from 2026-11-03 to 2026-11-06 for 2',
    );
    expect(names).toContain('stays.search');
    expect(names).not.toContain('web.search');
  });

  it('leaves the web in place for a question that is not a price', () => {
    expect(routeTools('Any good restaurants near the old town we should try?')).toContain(
      'web.search',
    );
    expect(routeTools('Look up online whether the museum is open on Mondays')).toContain(
      'web.search',
    );
  });

  it('does not treat a planning question that says "stay" as a room rate', () => {
    const names = routeTools('How long should I stay in Lisbon?');
    expect(names).not.toContain('stays.search');
    expect(names).not.toContain('flights.search');
  });
});

describe('flights.search', () => {
  it('returns what the vendor priced, with its source and the moment it was read', async () => {
    const { ctx } = stub('flight', [serpapi()], respondFlights);
    const result = await runTool(
      findTool('flights.search')!,
      'Find me a flight from Lagos to Lisbon on 2026-11-03',
      hints('Find me a flight from Lagos to Lisbon on 2026-11-03'),
      'router',
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/2 live flight offers/);
    expect(result.summary).toMatch(/SerpApi/);
    expect(result.summary).toMatch(/Lowest priced 620\.50 EUR/);
    const data = result.data as { offers: Array<Record<string, unknown>> };
    expect(data.offers).toHaveLength(2);
    expect(data.offers[0]).toMatchObject({
      provider: 'SerpApi',
      adapter: 'serpapi',
      currency: 'EUR',
      amount: 620.5,
      route: 'LOS → LIS',
      retrievedAt: now.toISOString(),
    });
    expect(result.summary).not.toMatch(/booked|available/i);
  });

  it('calls no source and quotes nothing when the route is half known', async () => {
    const { ctx, calls } = stub('flight', [serpapi()], respondFlights);
    const result = await runTool(
      findTool('flights.search')!,
      'Any flights to Lisbon?',
      hints('Any flights to Lisbon?'),
      'router',
      ctx,
    );

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/needs an origin city, a departure date/);
    expect(result.summary).toMatch(/web page is not a fare/);
  });

  it('says no source is configured instead of inventing a fare', async () => {
    const { ctx, calls } = stub('flight', [], respondFlights);
    const result = await runTool(
      findTool('flights.search')!,
      'Find me a flight from Lagos to Lisbon on 2026-11-03',
      hints('Find me a flight from Lagos to Lisbon on 2026-11-03'),
      'router',
      ctx,
    );

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/No flight source is configured/);
    expect(result.data).toBeNull();
  });

  it('names partial coverage when one source of two fails', async () => {
    const failing = serpapi({ providerId: 'backup', apiKey: 'serp-key-down' });
    const { ctx } = stub('flight', [serpapi(), failing], (call) =>
      call.authorization === 'Bearer serp-key-down'
        ? Promise.resolve(json({ error: 'boom' }, 500))
        : respondFlights(call),
    );

    const result = await runTool(
      findTool('flights.search')!,
      'Find me a flight from Lagos to Lisbon on 2026-11-03',
      hints('Find me a flight from Lagos to Lisbon on 2026-11-03'),
      'router',
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/1 of 2 sources failed/);
    expect(result.warning).toBeUndefined();
  });

  it('searches a route the model assembled from earlier messages', async () => {
    const { ctx } = stub('flight', [serpapi()], respondFlights);
    // The traveler's last message carries none of the route; the model's
    // arguments do, which is the case the deterministic desk hand-off cannot do.
    const result = await runTool(
      findTool('flights.search')!,
      'How about the 3rd instead?',
      hints('How about the 3rd instead?', {
        origin: 'Lagos',
        destination: 'Lisbon',
        departDate: '2026-11-03',
      }),
      'model',
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/Lagos → Lisbon on 2026-11-03/);
  });
});

describe('stays.search', () => {
  it('returns vendor room rates and drops a property the vendor did not price', async () => {
    const { ctx } = stub('stay', [serpapi()], async () => json(hotelsPayload));
    const result = await runTool(
      findTool('stays.search')!,
      'I need a hotel in Lisbon from 2026-11-03 to 2026-11-06 for 2',
      hints('I need a hotel in Lisbon from 2026-11-03 to 2026-11-06 for 2'),
      'router',
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/1 live stay offer/);
    const data = result.data as {
      kind: string;
      offers: Array<Record<string, unknown>>;
      dropped: number;
    };
    expect(data.kind).toBe('stay');
    expect(data.dropped).toBe(1);
    expect(data.offers[0]).toMatchObject({
      title: 'Harbour View Hotel',
      currency: 'EUR',
      amount: 1584,
      holdSupport: 'unsupported',
    });
  });
});

describe('a turn that prices a fare without a model', () => {
  it('renders the vendor fare as the reply, not a web snippet', async () => {
    const { ctx } = stub('flight', [serpapi()], respondFlights);
    const turn = await completeTurn(
      request('Find me a flight from Lagos to Lisbon on 2026-11-03'),
      { provider: mockProvider(), ctx },
    );

    expect(turn.tools.map((tool) => tool.name)).toContain('flights.search');
    expect(turn.reply).toMatch(/620\.50 EUR/);
    expect(turn.reply).toMatch(/SerpApi/);
    expect(turn.reply).toMatch(/Nothing is booked/);
  });
});

/** A provider that answers from a script, the way `turn.test.ts` drives one. */
function scriptedProvider(replies: ModelCompletion[]): ModelProvider & {
  calls: Array<{ tools?: Array<{ name: string }> }>;
} {
  const calls: Array<{ tools?: Array<{ name: string }> }> = [];
  return {
    id: 'openai',
    model: 'gpt-test',
    usesTools: true,
    calls,
    async complete(input) {
      calls.push({ tools: input.tools });
      return replies[Math.min(calls.length - 1, replies.length - 1)];
    },
  };
}

describe('a turn where the model asks for fares', () => {
  it('runs the fare tool the model called and narrates its prices', async () => {
    const { ctx } = stub('flight', [serpapi()], respondFlights);
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [
          {
            id: 'call_1',
            name: 'flights.search',
            arguments: JSON.stringify({
              origin: 'Lagos',
              destination: 'Lisbon',
              departDate: '2026-11-03',
            }),
          },
        ],
      },
      {
        text: 'Two fares from SerpApi; the lower is 620.50 EUR.',
        provider: 'openai',
        model: 'gpt-test',
      },
    ]);

    const turn = await completeTurn(request('Lagos to Lisbon on the 3rd of November'), {
      provider,
      ctx,
    });

    const fare = turn.toolResults.find((result) => result.name === 'flights.search');
    expect(fare?.ok).toBe(true);
    expect(turn.reply).toMatch(/620\.50 EUR/);
  });
});
