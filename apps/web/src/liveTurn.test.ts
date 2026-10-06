import { describe, expect, it } from 'vitest';
import type { LiveTurnRecord, TurnStepRecord } from '@travelclaw/shared';
import { adoptLiveTurn } from './liveTurn';
import type { LiveTurnState } from './components/LiveTurn';

/**
 * The two views of one running turn — the stream's deltas and the plain GET that
 * is the floor under them — arrive out of order, so folding them together must
 * never show the traveler less than they have already seen.
 */

function step(overrides: Partial<TurnStepRecord> = {}): TurnStepRecord {
  return {
    id: 'tool:tool-0',
    kind: 'tool',
    name: 'trip.outline',
    label: 'day-by-day outline',
    state: 'running',
    at: '2026-10-06T10:00:00.000Z',
    ...overrides,
  };
}

function local(overrides: Partial<LiveTurnState> = {}): LiveTurnState {
  return {
    steps: [],
    reasoning: '',
    reply: '',
    modelLabel: 'the desk',
    provider: '',
    startedAt: Date.now(),
    ...overrides,
  };
}

function snapshot(overrides: Partial<LiveTurnRecord> = {}): LiveTurnRecord {
  return {
    turnId: 'turn-1',
    sessionId: 'chat-1',
    modelLabel: 'GPT-4o mini',
    provider: 'openai',
    startedAt: '2026-10-06T10:00:00.000Z',
    steps: [],
    reasoning: '',
    reply: '',
    ...overrides,
  };
}

describe('folding the running turn into the live card', () => {
  it('takes the first thing the gateway reports when the stream has said nothing', () => {
    const next = adoptLiveTurn(local(), snapshot({ reply: 'Here is a plan', steps: [step()] }));

    expect(next?.reply).toBe('Here is a plan');
    expect(next?.steps).toHaveLength(1);
    expect(next?.modelLabel).toBe('GPT-4o mini');
    expect(next?.provider).toBe('openai');
  });

  it('never shortens an answer the stream has written further than the poll', () => {
    const current = local({
      reply: 'Here is a five day plan for Lisbon',
      modelLabel: 'GPT-4o mini',
      provider: 'openai',
    });
    const next = adoptLiveTurn(current, snapshot({ reply: 'Here is a five' }));

    expect(next?.reply).toBe('Here is a five day plan for Lisbon');
    // Nothing changed, so the same object comes back: no re-render for a poll
    // that only confirmed what the screen already showed.
    expect(next).toBe(current);
  });

  it('lets the stream move a step forward even when the poll still shows it running', () => {
    const current = local({
      steps: [step({ state: 'done', detail: '5-day outline for Lisbon.' })],
    });
    const next = adoptLiveTurn(current, snapshot({ steps: [step()] }));

    expect(next?.steps[0]).toMatchObject({ state: 'done', detail: '5-day outline for Lisbon.' });
  });

  it('takes a step the gateway has that the stream has not reached yet', () => {
    const current = local({ steps: [step({ id: 'stage:read', kind: 'stage', label: 'Read your message' })] });
    const next = adoptLiveTurn(
      current,
      snapshot({
        steps: [
          { id: 'stage:read', kind: 'stage', label: 'Read your message', state: 'done', at: 'x' },
          step({ state: 'done', detail: '5-day outline for Lisbon.' }),
        ],
      }),
    );

    expect(next?.steps.map((item) => item.id)).toEqual(['stage:read', 'tool:tool-0']);
    expect(next?.steps[1]).toMatchObject({ state: 'done', detail: '5-day outline for Lisbon.' });
  });

  it('does nothing at all when there is no live card to fold into', () => {
    expect(adoptLiveTurn(null, snapshot({ reply: 'anything' }))).toBeNull();
  });
});
