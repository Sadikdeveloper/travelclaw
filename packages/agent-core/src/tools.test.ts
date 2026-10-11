import { describe, expect, it } from 'vitest';
import { airlineRouteData, lookupRoute } from './airlines';
import { planAgentDesks } from './desks';
import { inclusiveDayCount } from './dates';
import {
  buildOutline,
  buildPackingList,
  estimateBudget,
  findTool,
  routeTools,
  runTool,
  toolSpecs,
  visaNotes,
} from './tools';
import { completeTurn, mockProvider } from './turn';
import { assemblePrompt } from './prompt';
import type { AirlineData } from './types';

describe('trip outline', () => {
  it('matches the inclusive date count and lightens the edges', () => {
    const outline = buildOutline({
      destination: 'Lisbon',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      interests: ['food'],
      pace: 'steady',
    });
    expect(outline).not.toBeNull();
    expect(outline?.days).toHaveLength(inclusiveDayCount('2026-10-12', '2026-10-16'));
    expect(outline?.days[0]?.title).toMatch(/Arrival/);
    expect(outline?.days.at(-1)?.title).toMatch(/buffer/i);
    expect(outline?.assumptions.join(' ')).toMatch(/not checked/i);
  });

  it('refuses a range over 18 days', () => {
    expect(
      buildOutline({
        destination: 'Rome',
        startDate: '2026-05-01',
        endDate: '2026-05-30',
        interests: [],
      }),
    ).toBeNull();
  });
});

describe('budget', () => {
  it('scales by travelers and excludes flights', () => {
    const budget = estimateBudget({
      destination: 'Lisbon',
      days: 5,
      travelers: 2,
      style: 'comfortable',
      interests: [],
    });
    expect(budget?.total).toBe((budget?.daily ?? 0) * 5 * 2);
    expect(budget?.excluded).toContain('flights');
  });
});

describe('packing', () => {
  it('includes a rain shell for a temperate city', () => {
    const list = buildPackingList({ destination: 'Lisbon', days: 4, interests: [] });
    expect(list.items.some((item) => /rain shell/i.test(item.name))).toBe(true);
  });

  it('includes a wind shell for Reykjavik', () => {
    const list = buildPackingList({ destination: 'Reykjavik', days: 3, interests: [] });
    expect(list.climate).toBe('cold');
    expect(list.items.some((item) => /windproof/i.test(item.name))).toBe(true);
  });
});

describe('agent desks', () => {
  it('wakes flight and stay together, and ignores a packing question', () => {
    expect(planAgentDesks('Book a flight and a hotel in Lisbon from Lagos')).toEqual([
      'flight',
      'stay',
    ]);
    expect(planAgentDesks('What should I pack for Reykjavik?')).toEqual([]);
  });
});

describe('router', () => {
  it('sends a visa question to the checklist, not an outline', () => {
    const names = routeTools('Do I need a visa for Japan with a Canadian passport?');
    expect(names[0]).toBe('visa.notes');
    expect(names).not.toContain('trip.outline');
  });

  it("checks a restaurant question with the desk's own research, not memory", () => {
    const names = routeTools('Any good restaurants near the old town we should try?');
    expect(names).toContain('web.search');
  });

  it('routes an opening-time question to the live source too', () => {
    const names = routeTools('What are the opening hours of the Gulbenkian museum?');
    expect(names).toContain('web.search');
  });

  it('caps a planning sentence at three tools', () => {
    const names = routeTools(
      'Plan 5 days in Lisbon from 2026-10-01, budget for 2 travelers, and suggest places',
    );
    expect(names.length).toBeLessThanOrEqual(3);
    expect(names).toContain('trip.outline');
  });
});

describe('visa notes', () => {
  it('does not claim a nationality can enter', () => {
    const notes = visaNotes({
      destination: 'Japan',
      passportCountry: 'Canada',
      interests: [],
    });
    expect(notes.disclaimer).toMatch(/not an entry ruling/i);
    expect(notes.checks.join(' ')).not.toMatch(/visa-free/i);
  });
});

describe('prompt', () => {
  it('omits a blank traveler file', () => {
    const prompt = assemblePrompt(
      {
        text: 'hello',
        persona: {
          name: 'Marlow',
          soul: 'Be brief.',
          identity: '',
          user: '   ',
          agents: '',
        },
        memory: [],
        history: [],
      },
      [],
    );
    expect(prompt).toContain('Be brief.');
    expect(prompt).not.toContain('## Traveler');
  });
});

describe('completeTurn', () => {
  it('answers a packing question from tools without a model', async () => {
    const turn = await completeTurn(
      {
        text: 'What should I pack for Reykjavik for 4 days?',
        persona: { name: 'Marlow', soul: 'Be brief.', identity: '', user: '', agents: '' },
        memory: [],
        history: [],
      },
      {
        provider: mockProvider(),
        ctx: { now: new Date('2026-03-01T00:00:00Z'), network: false },
      },
    );
    expect(turn.provider).toBe('mock');
    expect(turn.tools.some((tool) => tool.name === 'packing.list' && tool.ok)).toBe(true);
    expect(turn.reply).toMatch(/windproof/i);
  });
});

describe('carrier directory', () => {
  const now = new Date('2026-10-11T00:00:00Z');
  const tool = findTool('airlines.find')!;

  /** One directory lookup through the real runner, including its error guard. */
  function lookup(origin?: string, destination?: string, at: Date = now) {
    return runTool(
      tool,
      '',
      {
        ...(origin ? { origin } : {}),
        ...(destination ? { destination } : {}),
        interests: [],
      },
      'router',
      { now: at, network: false },
    );
  }

  it('is registered with a router-safe argument contract', () => {
    expect(tool).toBeDefined();
    // Both args are optional, so a rejected payload is never coerced into a
    // half-route lookup: the runner asks for the missing end instead.
    expect(toolSpecs([tool])[0]?.parameters.required ?? []).toEqual([]);
  });

  it('names the single listed carrier on Kaduna to Lagos with its booking channel', async () => {
    const result = await lookup('Kaduna', 'Lagos');
    expect(result.ok).toBe(true);
    const data = result.data as AirlineData;
    expect(data.listed).toBe(true);
    expect(data.singleCarrier).toBe(true);
    expect(data.from?.code).toBe('KAD');
    expect(data.to?.code).toBe('LOS');
    expect(data.carriers).toHaveLength(1);
    expect(data.carriers[0]?.name).toBe('Rano Air');
    expect(data.carriers[0]?.bookingUrl).toBe('https://www.ranoair.com/');
    // The directory's real purpose: can a reservation exist before payment?
    expect(data.carriers[0]?.paymentOrder).toBe('pnr_then_pay');
    expect(data.carriers[0]?.evidence).toMatch(/ranoair\.com/);
    expect(data.summary).toMatch(/only carrier that flies/i);
  });

  it('treats a listed pair as bidirectional', () => {
    const forward = lookupRoute('Kaduna', 'Lagos');
    const back = lookupRoute('Lagos', 'Kaduna');
    expect(forward.fact).toBeDefined();
    expect(forward.fact).toBe(back.fact);
    expect(forward.carriers?.map((airline) => airline.id)).toEqual(['rano-air']);
  });

  it('never reports a price, and dates its own rows', async () => {
    const result = await lookup('KAD', 'LOS');
    const data = result.data as AirlineData;
    expect(JSON.stringify(data)).not.toMatch(/"(price|amount|totalAmount)"/);
    expect(result.summary).toMatch(/availability was not checked/i);
    expect(data.staleDays).toBe(0);
    expect(data.caveats.join(' ')).toMatch(/not a fare/i);
    // A stale row has to be visibly stale rather than quietly trusted.
    const aged = airlineRouteData('KAD', 'LOS', new Date('2026-11-20T00:00:00Z'));
    expect(aged?.staleDays).toBe(40);
  });

  it('reports an unlisted pair as a gap, not as proof of no service', async () => {
    const result = await lookup('Ilorin', 'Sokoto');
    const data = result.data as AirlineData;
    expect(data.known).toBe(true);
    expect(data.listed).toBe(false);
    expect(data.carriers).toHaveLength(0);
    expect(data.summary).toMatch(/not proof of no service/i);
    // Country-level carriers are offered, and labelled as not route proof.
    expect((data.fallbackCarriers ?? []).length).toBeGreaterThan(0);
    expect(data.verification).toMatch(/not route proof/i);
  });

  it('refuses a place the directory does not know instead of guessing a code', async () => {
    const result = await lookup('Kaduna', 'Reykjavik');
    const data = result.data as AirlineData;
    expect(data.known).toBe(false);
    expect(data.from).toBeNull();
    expect(data.verification).toMatch(/Reykjavik/);
    expect(data.verification).toMatch(/airport code/);
  });

  it('refuses a route whose two ends are the same place', async () => {
    const result = await lookup('Lagos', 'LOS');
    expect((result.data as AirlineData).verification).toMatch(/both ends/i);
  });

  it('refuses half a route: no invented second end', async () => {
    // A model call that names one end gets asked for the other.
    const modelCall = await lookup('Kaduna');
    expect(modelCall.ok).toBe(false);
    expect(modelCall.data).toBeNull();

    // A router call recovers the pair from the traveler's own words, because the
    // shared extractor resolves a destination only from editorial cards.
    const routerCall = await runTool(
      tool,
      'Which airlines fly from Kaduna to Lagos?',
      { origin: 'Kaduna', interests: [] },
      'router',
      { now, network: false },
    );
    expect(routerCall.ok).toBe(true);
    expect((routerCall.data as AirlineData).carriers[0]?.name).toBe('Rano Air');

    // And a message naming one known place and one unknown place is still a
    // refusal, not a route to somewhere invented.
    const halfKnown = await runTool(
      tool,
      'Which airlines fly from Kaduna to Reykjavik?',
      { origin: 'Kaduna', interests: [] },
      'router',
      { now, network: false },
    );
    // The pair never resolves, so the directory refuses rather than answering
    // for a route it cannot name. The refusal names the place it does not know.
    expect(halfKnown.ok).toBe(false);
    expect(halfKnown.data).toBeNull();
    expect(halfKnown.summary).toMatch(/both ends/i);
  });

  it('flags carriers whose payment order nobody has verified', async () => {
    const result = await lookup('Lagos', 'Uyo');
    const data = result.data as AirlineData;
    expect(data.carriers.length).toBeGreaterThan(1);
    expect(data.carriers.some((airline) => airline.paymentOrder === 'unverified')).toBe(
      true,
    );
    expect(data.caveats.join(' ')).toMatch(/payment order is unverified/i);
    expect(data.caveats.join(' ')).toMatch(/do not claim a reservation/i);
  });

  it('routes the carrier question, and leaves a bare fare ask to the fare tool', () => {
    const carrier = routeTools(
      'Which airlines fly from Kaduna to Lagos, and where do I book?',
    );
    expect(carrier).toContain('airlines.find');

    const fare = routeTools('Cheapest flights from Lagos to Lisbon in March');
    expect(fare).not.toContain('airlines.find');
    expect(fare).toContain('flights.search');
  });

  it('answers the carrier question with no model key at all', async () => {
    const turn = await completeTurn(
      {
        text: 'Which airlines fly from Kaduna to Lagos?',
        persona: { name: 'Marlow', soul: 'Be brief.', identity: '', user: '', agents: '' },
        memory: [],
        history: [],
      },
      { provider: mockProvider(), ctx: { now, network: false } },
    );
    expect(turn.provider).toBe('mock');
    expect(turn.tools.some((item) => item.name === 'airlines.find' && item.ok)).toBe(true);
    expect(turn.reply).toMatch(/Rano Air/);
    expect(turn.reply).toMatch(/booking reference before payment/);
    expect(turn.reply).toMatch(/Nothing is booked/);
  });
});
