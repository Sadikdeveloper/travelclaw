import { describe, expect, it } from 'vitest';
import { planToolCalls, runToolPlan, toolCallKey, TOOL_CALL_LIMITS } from './tool-calls';
import { completeTurn } from './turn';
import type {
  HistoryTurn,
  ModelCompletion,
  ModelProvider,
  ModelToolCall,
  TurnRequest,
} from './types';

/**
 * The desk's own brakes. A model that wants to search again gets a sentence
 * explaining why it cannot, rather than a silent starvation it will read as a
 * transient failure and try to work around:
 *
 * - a per-turn limit on a tool that is cheap to call, easy to loop on, and never
 *   the source of a price (`TOOL_CALL_LIMITS`);
 * - a refusal for a tool this turn already failed for a reason a retry cannot
 *   fix, so a fresh set of arguments cannot rediscover the same wall.
 *
 * Both come back as a `blocked` result: `ok: false` because nothing ran, and
 * marked so no failure counter can read the desk's own verdict as a tool error.
 */

function call(name: string, args: unknown): ModelToolCall {
  return {
    id: `call_${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
  };
}

describe('per-turn tool limits', () => {
  it('caps a loopable tool and blocks the call past the limit with a verdict', () => {
    const plan = planToolCalls({
      text: 'search the web for Lisbon museums',
      routerNames: [],
      modelCalls: [
        call('web.search', { query: 'one' }),
        call('web.search', { query: 'two' }),
        call('web.search', { query: 'three' }),
      ],
    });

    expect(TOOL_CALL_LIMITS['web.search']).toBe(2);
    expect(plan.calls).toHaveLength(2);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0]).toMatchObject({ name: 'web.search', ok: false, blocked: true });
    expect(plan.blocked[0].summary).toMatch(/per-turn limit/);
    expect(plan.blocked[0].summary).toMatch(/looks like a loop/);
    // A block is not a rejection: the request itself was well formed.
    expect(plan.rejected).toHaveLength(0);
  });

  it('counts the searches an earlier pass already ran against the limit', () => {
    const plan = planToolCalls({
      text: '',
      routerNames: [],
      modelCalls: [call('web.search', { query: 'third' })],
      ran: [
        toolCallKey('web.search', '{"query":"first"}'),
        toolCallKey('web.search', '{"query":"second"}'),
      ],
      ranTools: ['web.search', 'web.search'],
      remaining: 1,
    });

    expect(plan.calls).toHaveLength(0);
    expect(plan.blocked).toHaveLength(1);
  });

  it('leaves an uncapped tool alone', () => {
    const plan = planToolCalls({
      text: '',
      routerNames: [],
      modelCalls: [
        call('currency.convert', { amount: 10, fromCurrency: 'USD', toCurrency: 'EUR' }),
        call('weather.outlook', { destination: 'Lisbon' }),
        call('visa.notes', { destination: 'Japan' }),
      ],
    });

    expect(plan.calls).toHaveLength(3);
    expect(plan.blocked).toHaveLength(0);
  });

  it('drops a router pick that would pass the limit, without a verdict to show', () => {
    const plan = planToolCalls({
      text: 'search the web for Lisbon museums',
      routerNames: ['web.search'],
      modelCalls: [],
      ranTools: ['web.search', 'web.search'],
      remaining: 1,
    });

    expect(plan.calls).toHaveLength(0);
    expect(plan.blocked).toHaveLength(0);
  });

  it('hands the verdict to the model as part of the turn’s results', async () => {
    const plan = planToolCalls({
      text: '',
      routerNames: [],
      modelCalls: [call('web.search', { query: 'third' })],
      ranTools: ['web.search', 'web.search'],
      remaining: 1,
    });

    const results = await runToolPlan(plan, '', {
      now: new Date('2026-10-07T09:00:00Z'),
      network: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'web.search', ok: false, blocked: true });
    expect(results[0].data).toBeNull();
  });
});

describe('a tool this turn already proved dead', () => {
  it('refuses new arguments for the same dead tool and names the reason', () => {
    const plan = planToolCalls({
      text: '',
      routerNames: [],
      modelCalls: [
        call('flights.search', {
          origin: 'Lagos',
          destination: 'Lisbon',
          departDate: '2026-11-03',
        }),
      ],
      dead: {
        'flights.search':
          'No flight source is configured on this desk, so nothing was priced',
      },
    });

    expect(plan.calls).toHaveLength(0);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].summary).toMatch(/No flight source is configured/);
    expect(plan.blocked[0].summary).toMatch(/instead of calling it again/);
    expect(plan.blocked[0].blocked).toBe(true);
  });

  it('still lets a different tool run', () => {
    const plan = planToolCalls({
      text: '',
      routerNames: [],
      modelCalls: [
        call('flights.search', { origin: 'Lagos', destination: 'Lisbon' }),
        call('weather.outlook', { destination: 'Lisbon' }),
      ],
      dead: { 'flights.search': 'No flight source is configured on this desk' },
    });

    expect(plan.calls.map((item) => item.name)).toEqual(['weather.outlook']);
    expect(plan.blocked.map((item) => item.name)).toEqual(['flights.search']);
  });
});

function scriptedProvider(replies: ModelCompletion[]) {
  const calls: Array<{ system: string; tools?: Array<{ name: string }> }> = [];
  const provider: ModelProvider & { calls: typeof calls } = {
    id: 'openai',
    model: 'gpt-test',
    usesTools: true,
    calls,
    async complete(input) {
      calls.push({ system: input.system, tools: input.tools });
      return replies[Math.min(calls.length - 1, replies.length - 1)];
    },
  };
  return provider;
}

function request(text: string, history: HistoryTurn[] = []): TurnRequest {
  return {
    text,
    persona: { name: 'Marlow', soul: 'Be brief.', identity: '', user: '', agents: '' },
    memory: [],
    history,
  };
}

/** A page the keyless search tier can actually parse, so both searches succeed. */
const readablePage = (async () =>
  new Response(
    '<html><body><a class="result__a" href="https://example.org/hours">Museum hours</a>' +
      '<a class="result__snippet">Open 10 to 18.</a></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html' } },
  )) as typeof fetch;

describe('a capped tool inside a live turn', () => {
  it('runs the first two searches, blocks the third, and says so to the model', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [
          call('web.search', { query: 'Lisbon museum hours' }),
          call('web.search', { query: 'Lisbon museum opening times' }),
          call('web.search', { query: 'Lisbon museum schedule official' }),
        ],
      },
      {
        text: 'Two searches agree: open 10 to 18. The third was not needed.',
        provider: 'openai',
        model: 'gpt-test',
      },
    ]);

    const turn = await completeTurn(request('Search the web for Lisbon museum hours'), {
      provider,
      ctx: {
        now: new Date('2026-10-07T09:00:00Z'),
        network: true,
        fetchImpl: readablePage,
      },
      toolRounds: 5,
    });

    expect(turn.toolResults).toHaveLength(3);
    expect(turn.toolResults.filter((result) => result.ok)).toHaveLength(2);
    const blocked = turn.toolResults.find((result) => result.blocked);
    expect(blocked?.summary).toMatch(/per-turn limit/);
    // The block is a stop signal, not an error the model should retry around.
    expect(provider.calls[1].system).toContain('blocked by the desk, nothing ran');
    expect(provider.calls[1].system).toContain('do not call that tool again');
    expect(turn.reply).toMatch(/open 10 to 18/i);
  });
});
