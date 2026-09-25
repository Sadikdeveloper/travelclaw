import { describe, expect, it } from 'vitest';
import { inclusiveDayCount } from './dates';
import {
  buildOutline,
  buildPackingList,
  estimateBudget,
  routeTools,
  visaNotes,
} from './tools';
import { completeTurn, mockProvider } from './turn';
import { assemblePrompt } from './prompt';

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

describe('router', () => {
  it('sends a visa question to the checklist, not an outline', () => {
    const names = routeTools('Do I need a visa for Japan with a Canadian passport?');
    expect(names[0]).toBe('visa.notes');
    expect(names).not.toContain('trip.outline');
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
