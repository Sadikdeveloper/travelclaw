import { describe, expect, it } from 'vitest';
import { extractHints } from './extract';
import { renderFallback } from './reply';
import { BUNDLED_TOOLS, findTool, runTool, type ToolDefinition } from './tools';
import { completeTurn, mockProvider } from './turn';
import type {
  HistoryTurn,
  ModelCompletion,
  ModelProvider,
  ModelToolCall,
  ModelToolSpec,
  TurnRequest,
} from './types';

interface ProviderCall {
  system: string;
  user: string;
  history: HistoryTurn[];
  fallback: string;
  tools?: ModelToolSpec[];
}

/** A provider that answers from a script and remembers what it was asked. */
function scriptedProvider(
  replies: ModelCompletion[],
  options: { usesTools?: boolean } = {},
): ModelProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = [];
  return {
    id: 'openai',
    model: 'gpt-test',
    usesTools: options.usesTools ?? true,
    calls,
    async complete(input: ProviderCall): Promise<ModelCompletion> {
      calls.push(input);
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      return reply;
    },
  };
}

function call(name: string, args: unknown): ModelToolCall {
  return { id: `call_${name}`, name, arguments: JSON.stringify(args) };
}

function request(text: string, history: HistoryTurn[] = []): TurnRequest {
  return {
    text,
    persona: { name: 'Marlow', soul: 'Be brief.', identity: '', user: '', agents: '' },
    memory: [],
    history,
  };
}

const ctx = { now: new Date('2026-03-01T00:00:00Z'), network: false };

describe('completeTurn with a model that calls tools', () => {
  it('sends the catalog, runs the call the model asked for, and narrates the result', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [
          call('trip.outline', {
            destination: 'Lisbon',
            startDate: '2026-10-12',
            days: 4,
            pace: 'steady',
          }),
        ],
      },
      {
        text: 'Four days in Lisbon, arrival light, nothing booked.',
        provider: 'openai',
        model: 'gpt-test',
      },
    ]);

    const turn = await completeTurn(request('Plan Lisbon from 2026-10-12'), {
      provider,
      ctx,
    });

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].tools).toHaveLength(BUNDLED_TOOLS.length);
    expect(provider.calls[0].system).toMatch(/No tool has run yet/);
    // The narration pass sees the tool data, and is not offered tools again.
    expect(provider.calls[1].tools).toBeUndefined();
    expect(provider.calls[1].system).toContain('2026-10-15');
    expect(turn.tools).toEqual([
      {
        name: 'trip.outline',
        ok: true,
        summary: expect.stringMatching(/4-day outline/),
        source: 'model',
      },
    ]);
    expect(turn.toolResults[0].source).toBe('model');
    expect(turn.reply).toBe('Four days in Lisbon, arrival light, nothing booked.');
    expect(turn.provider).toBe('openai');
  });

  it('falls back to the router when the model asks for nothing', async () => {
    const provider = scriptedProvider([
      { text: 'Let me think about that.', provider: 'openai', model: 'gpt-test' },
      { text: 'Here is your packing list.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(
      request('What should I pack for Reykjavik for 4 days?'),
      { provider, ctx },
    );

    expect(provider.calls).toHaveLength(2);
    expect(turn.tools).toEqual([
      {
        name: 'packing.list',
        ok: true,
        summary: expect.stringMatching(/packing notes/),
        source: 'router',
      },
    ]);
    expect(provider.calls[1].system).toMatch(/windproof/i);
    expect(turn.reply).toBe('Here is your packing list.');
  });

  it('answers without a second pass when no tool fits', async () => {
    const provider = scriptedProvider([
      { text: 'I am Marlow. Where are you going?', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(request('Hello there'), { provider, ctx });

    expect(provider.calls).toHaveLength(1);
    expect(turn.tools).toEqual([]);
    expect(turn.reply).toBe('I am Marlow. Where are you going?');
  });

  it('runs a tool once when the model and the router both pick it', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('packing.list', { destination: 'Reykjavik', days: 4 })],
      },
      { text: 'Packed.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(
      request('What should I pack for Reykjavik for 4 days?'),
      { provider, ctx },
    );

    expect(turn.tools).toHaveLength(1);
    expect(turn.tools[0].source).toBe('model');
  });

  it('holds the three-tool ceiling even when the model asks for five', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [
          call('packing.list', { destination: 'Lisbon', days: 4 }),
          call('places.suggest', { destination: 'Lisbon' }),
          call('weather.outlook', { destination: 'Lisbon' }),
          call('visa.notes', { destination: 'Lisbon', passportCountry: 'Canada' }),
          call('budget.estimate', { destination: 'Lisbon', days: 4 }),
        ],
      },
      { text: 'Done.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(
      request('Plan 4 days in Lisbon with a budget and a packing list'),
      { provider, ctx },
    );

    expect(turn.tools).toHaveLength(3);
    expect(turn.tools.map((tool) => tool.name)).toEqual([
      'packing.list',
      'places.suggest',
      'weather.outlook',
    ]);
  });
});

describe('rejected model calls', () => {
  it('rejects a bad argument payload and never runs the tool', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [
          call('currency.convert', {
            amount: 'one hundred',
            fromCurrency: 'USD',
            toCurrency: 'EUR',
          }),
        ],
      },
      {
        text: 'How much would you like to convert?',
        provider: 'openai',
        model: 'gpt-test',
      },
    ]);

    const turn = await completeTurn(request('Money question'), { provider, ctx });

    expect(turn.toolResults).toHaveLength(1);
    expect(turn.toolResults[0].ok).toBe(false);
    expect(turn.toolResults[0].data).toBeNull();
    expect(turn.toolResults[0].warning).toMatch(/amount/);
    expect(turn.tools[0]).toMatchObject({ name: 'currency.convert', ok: false });
    // The model still gets a grounded second pass, with the rejection in it.
    expect(provider.calls[1].system).toMatch(/needs input/);
    expect(turn.reply).toBe('How much would you like to convert?');
  });

  it('keeps schema wording out of the desk rendering', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [{ id: 'call_1', name: 'places.suggest', arguments: 'not json at all' }],
      },
      { text: '', provider: 'mock', model: 'travelclaw-local' },
    ]);

    const turn = await completeTurn(request('Hello there'), { provider, ctx });
    const rendering = renderFallback('Hello there', turn.toolResults, 'Marlow');

    expect(rendering).toMatch(/could not read that place list request/i);
    expect(rendering).toMatch(/have not booked anything/i);
    expect(rendering).not.toMatch(/JSON|schema|zod|Expected/i);
  });

  it('rejects a tool that is not on this desk', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('flight.book', { destination: 'Lisbon' })],
      },
      { text: 'I cannot book flights.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(request('Book me a flight'), { provider, ctx });

    expect(turn.toolResults[0].ok).toBe(false);
    expect(turn.toolResults[0].warning).toMatch(/unknown tool/);
    expect(turn.reply).toBe('I cannot book flights.');
  });

  it('lets the router cover a malformed call for the same tool', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('trip.outline', { destination: 'Lisbon' })],
      },
      { text: 'Here is the outline.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(request('Plan 4 days in Lisbon from 2026-10-12'), {
      provider,
      ctx,
    });

    expect(turn.tools).toEqual([
      {
        name: 'trip.outline',
        ok: true,
        summary: expect.stringMatching(/4-day outline/),
        source: 'router',
      },
    ]);
    expect(turn.toolResults.some((result) => !result.ok)).toBe(false);
  });
});

describe('the offline path', () => {
  it('never offers tools to a provider without tool support', async () => {
    const provider = mockProvider();
    const calls: ProviderCall[] = [];
    const watched: ModelProvider = {
      ...provider,
      async complete(input: ProviderCall) {
        calls.push(input);
        return { text: input.fallback, provider: 'mock', model: provider.model };
      },
    };

    const turn = await completeTurn(
      request('What should I pack for Reykjavik for 4 days?'),
      { provider: watched, ctx },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].tools).toBeUndefined();
    expect(turn.tools[0]).toMatchObject({ name: 'packing.list', source: 'router' });
    expect(turn.reply).toMatch(/windproof/i);
  });

  it('keeps /remember deterministic and grounds the narration', async () => {
    const provider = scriptedProvider([
      { text: 'Noted.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(request('/remember I prefer trains to taxis'), {
      provider,
      ctx,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].tools).toBeUndefined();
    expect(turn.remembered?.body).toBe('I prefer trains to taxis');
    expect(turn.tools[0]).toMatchObject({ name: 'memory.remember', source: 'router' });
  });
});

describe('tool errors', () => {
  it('turns a thrown tool into a failed result instead of losing the turn', async () => {
    const broken: ToolDefinition = {
      ...findTool('packing.list')!,
      run: () => {
        throw new Error('desk card missing');
      },
    };

    const result = await runTool(
      broken,
      'Pack for Reykjavik',
      extractHints('Reykjavik'),
      'router',
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.warning).toBe('desk card missing');
    expect(result.source).toBe('router');
    expect(result.summary).toMatch(/packing list hit an error/i);
  });
});

describe('history', () => {
  it('passes the last eight turns to the provider', async () => {
    const history: HistoryTurn[] = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${index}`,
    }));
    const provider = scriptedProvider([
      { text: 'ok', provider: 'openai', model: 'gpt-test' },
    ]);

    await completeTurn(request('Hello there', history), { provider, ctx });

    expect(provider.calls[0].history).toHaveLength(8);
    expect(provider.calls[0].history[0].content).toBe('turn 2');
  });
});
