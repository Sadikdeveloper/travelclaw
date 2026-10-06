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
    expect(provider.calls[1].system).toMatch(/not successful/);
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

  it('shows a model note to the model but never to the router', async () => {
    const provider = scriptedProvider([
      { text: 'Got the file, thanks.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(
      {
        ...request('hello'),
        modelNote: '[attached: packing-list.pdf (document)]',
      },
      { provider, ctx },
    );

    expect(provider.calls[0].user).toContain('hello');
    expect(provider.calls[0].user).toContain('packing-list.pdf');
    // The router chose from "hello" alone — a file named packing-list.pdf did not
    // summon the packing tool.
    expect(turn.tools.map((tool) => tool.name)).not.toContain('packing.list');
    expect(turn.reply).toBe('Got the file, thanks.');
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

const SEARCH_HTML = `
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Flisbon">Lisbon in November</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Flisbon">November is cool and quiet.</a>
</div>
`;

const PAGE_HTML =
  '<html><head><title>Lisbon in November</title></head><body><p>Pack a rain shell.</p></body></html>';

function webFetchStub(): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('duckduckgo.com'))
      return new Response(SEARCH_HTML, { status: 200 });
    if (init?.method === 'POST') return new Response(SEARCH_HTML, { status: 200 });
    return new Response(PAGE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe('the agentic turn', () => {
  it('searches, reads a page, then answers — inside one turn budget', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('web.search', { query: 'lisbon in november' })],
      },
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('web.fetch', { url: 'https://example.org/lisbon' })],
      },
      {
        text: 'November is cool, quiet, and wet. Pack a shell.',
        provider: 'openai',
        model: 'gpt-test',
      },
    ]);
    const { impl, calls } = webFetchStub();

    const turn = await completeTurn(request('What is Lisbon like in November?'), {
      provider,
      ctx: { now: new Date('2026-10-06T09:00:00Z'), network: true, fetchImpl: impl },
      toolRounds: 3,
    });

    expect(provider.calls).toHaveLength(3);
    // Pass two sees what pass one returned, and the catalog is still on offer.
    expect(provider.calls[1].system).toContain('web.search');
    expect(provider.calls[1].tools).toHaveLength(BUNDLED_TOOLS.length);
    expect(turn.toolResults.map((result) => result.name)).toEqual([
      'web.search',
      'web.fetch',
    ]);
    expect(turn.reply).toBe('November is cool, quiet, and wet. Pack a shell.');
    expect(calls).toContain('https://example.org/lisbon');
  });

  it('hands the tools the turn’s Stop, so a stopped turn stops the call', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('web.fetch', { url: 'https://example.org/lisbon' })],
      },
      { text: 'The page would not load.', provider: 'openai', model: 'gpt-test' },
    ]);
    const controller = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const abortedWithIt: boolean[] = [];
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      if (signal && signals.length === 0) {
        // Stop the turn mid-call. The signal the tool was given has to follow
        // it, or a stopped turn keeps a vendor call — and a retry — alive.
        controller.abort();
        abortedWithIt.push(signal.aborted);
      }
      signals.push(signal);
      return new Response('upstream error', { status: 503 });
    }) as typeof fetch;

    // A stopped turn ends the turn loop itself; what is under test here is
    // what happened to the call that was already in flight.
    await expect(
      completeTurn(request('What is Lisbon like in November?'), {
        provider,
        ctx: { now: new Date('2026-10-06T09:00:00Z'), network: true, fetchImpl: impl },
        signal: controller.signal,
        toolRounds: 1,
      }),
    ).rejects.toBeTruthy();

    expect(abortedWithIt).toEqual([true]);
    // The page answered 503, which is normally worth another ask. Not after
    // Stop: the retry is abandoned while it is still this turn's call.
    expect(signals).toHaveLength(1);
  });

  it('retries after a model announces an alternative instead of leaving that as the answer', async () => {
    const replies: ModelCompletion[] = [
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('web.search', { query: 'Lisbon museum official opening hours' })],
      },
      {
        text: "The first search returned nothing. I'll try another query.",
        provider: 'openai',
        model: 'gpt-test',
      },
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('web.search', { query: 'official Lisbon museum hours site' })],
      },
      {
        text: 'The search desk is offline, so no current hours could be checked.',
        provider: 'openai',
        model: 'gpt-test',
      },
    ];
    const calls: ProviderCall[] = [];
    const provider: ModelProvider & { calls: ProviderCall[] } = {
      id: 'openai',
      model: 'gpt-test',
      usesTools: true,
      streams: true,
      calls,
      async complete(input) {
        calls.push(input);
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
        if (reply.text) input.onDelta?.({ text: reply.text });
        return reply;
      },
    };
    const events: string[] = [];
    const liveReasoning: string[] = [];

    const turn = await completeTurn(
      request('Search the web for Lisbon museum opening hours'),
      {
        provider,
        ctx,
        toolRounds: 5,
        onEvent: (event) => {
          events.push(event.type);
          if (event.type === 'reasoning') liveReasoning.push(event.text);
        },
      },
    );

    expect(calls).toHaveLength(4);
    expect(calls[1].system).toContain('not successful');
    expect(calls[1].system).toContain('make that call now');
    expect(calls[2].tools).toHaveLength(BUNDLED_TOOLS.length);
    expect(events).toContain('reply_reset');
    expect(liveReasoning).toContain(
      'The last result was not useful. I’m checking whether another available approach can help.',
    );
    expect(turn.toolResults).toHaveLength(2);
    expect(turn.toolResults.every((result) => !result.ok)).toBe(true);
    expect(turn.reply).toBe(
      'The search desk is offline, so no current hours could be checked.',
    );
    expect(turn.reply).not.toMatch(/I'll try another query/i);
  });

  it('does not save a retry promise when the final pass has no tools left', async () => {
    const replies: ModelCompletion[] = [
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('web.search', { query: 'Lisbon museum opening hours' })],
      },
      {
        text: "I couldn't get a result. I'll try another source.",
        provider: 'openai',
        model: 'gpt-test',
      },
    ];
    const calls: ProviderCall[] = [];
    const provider: ModelProvider & { calls: ProviderCall[] } = {
      id: 'openai',
      model: 'gpt-test',
      usesTools: true,
      streams: true,
      calls,
      async complete(input) {
        calls.push(input);
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
        if (reply.text) input.onDelta?.({ text: reply.text });
        return reply;
      },
    };
    const events: string[] = [];

    const turn = await completeTurn(request('Search for Lisbon museum opening hours'), {
      provider,
      ctx,
      toolRounds: 1,
      onEvent: (event) => events.push(event.type),
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].tools).toBeUndefined();
    expect(events).toContain('reply_reset');
    expect(turn.reply).not.toMatch(/I'll try another source/i);
    expect(turn.reply).toMatch(/did not return results/i);
  });

  it('reports every tool as it starts and finishes, in order', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('web.search', { query: 'lisbon weather' })],
      },
      { text: 'Cool and damp.', provider: 'openai', model: 'gpt-test' },
    ]);
    const { impl } = webFetchStub();
    const events: string[] = [];

    await completeTurn(request('What is Lisbon like in November?'), {
      provider,
      ctx: { now: new Date('2026-10-06T09:00:00Z'), network: true, fetchImpl: impl },
      toolRounds: 2,
      onEvent: (event) => {
        if (event.type === 'tool_start') events.push(`start:${event.name}:${event.source}`);
        if (event.type === 'tool_end') events.push(`end:${event.name}:${event.ok}`);
        if (event.type === 'stage') events.push(`stage:${event.id}:${event.state}`);
      },
    });

    expect(events).toEqual([
      // The plan is announced, then each execution is announced as it runs.
      'stage:read:done',
      'stage:plan-0:done',
      'start:web.search:model',
      'end:web.search:true',
      // The second pass had nothing left to run and answered from the result.
      'stage:plan:done',
      'stage:write:done',
    ]);
  });

  it('streams reasoning and the answer when a screen is watching', async () => {
    const provider: ModelProvider = {
      id: 'openai',
      model: 'gpt-test',
      usesTools: true,
      streams: true,
      async complete(input) {
        input.onDelta?.({ reasoning: 'Checking the desk files.' });
        input.onDelta?.({ text: 'Two ' });
        input.onDelta?.({ text: 'cities.' });
        return { text: 'Two cities.', provider: 'openai', model: 'gpt-test' };
      },
    };
    const events: Array<{ type: string; text?: string }> = [];

    await completeTurn(request('Where should I go in November?'), {
      provider,
      ctx,
      onEvent: (event) => events.push(event),
    });

    expect(events.filter((event) => event.type === 'reasoning')).toEqual([
      { type: 'reasoning', text: 'Checking the desk files.' },
    ]);
    expect(events.filter((event) => event.type === 'reply_delta')).toEqual([
      { type: 'reply_delta', text: 'Two ' },
      { type: 'reply_delta', text: 'cities.' },
    ]);
  });

  it('paces a desk rendering out in slices that add up to the whole reply', async () => {
    const events: string[] = [];
    const turn = await completeTurn(request('Plan Lisbon for 4 days from 2026-10-12'), {
      provider: mockProvider(),
      ctx,
      onEvent: (event) => {
        if (event.type === 'reply_delta') events.push(event.text);
      },
    });

    // More than one slice, and nothing invented to fill the gap: joined, the
    // slices are the reply the turn returned.
    expect(events.length).toBeGreaterThan(1);
    expect(events.join('').trim()).toBe(turn.reply);
    expect(turn.reply).toMatch(/Outline for Lisbon/);
  });

  it('keeps a whole surrogate pair in one slice', async () => {
    const events: string[] = [];
    const provider = mockProvider();
    await provider.complete({
      system: '',
      history: [],
      user: '',
      fallback: 'Bon voyage 🧳🌍 — safe travels',
      onDelta: (delta) => {
        if (delta.text) events.push(delta.text);
      },
    });

    // No slice may end in a lone surrogate, which is what a UTF-16 cut does.
    for (const chunk of events) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(events.join('')).toBe('Bon voyage 🧳🌍 — safe travels');
  });

  it('stops pacing a desk rendering when the turn is stopped', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const provider = mockProvider();
    const done = provider.complete({
      system: '',
      history: [],
      user: '',
      fallback: 'x'.repeat(4000),
      signal: controller.signal,
      onDelta: (delta) => {
        if (delta.text) events.push(delta.text);
      },
    });
    controller.abort();
    const completion = await done;

    // Stopped well short of 4000 characters, and still an honest completion.
    expect(events.join('').length).toBeLessThan(4000);
    expect(completion.text).toHaveLength(4000);
  });

  it('runs an identical call once, however many times the model asks for it', async () => {
    const endless = {
      text: '',
      provider: 'openai',
      model: 'gpt-test',
      toolCalls: [
        call('currency.convert', { amount: 10, fromCurrency: 'USD', toCurrency: 'EUR' }),
      ],
    };
    const provider = scriptedProvider([
      endless,
      endless,
      { text: 'Done.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(request('convert 10 USD to EUR'), {
      provider,
      ctx,
      toolRounds: 3,
    });

    // Asking again for what already ran is not work: the result is in the model's
    // context, so the desk answers from it instead of repeating the call.
    expect(turn.toolResults).toHaveLength(1);
    expect(turn.reply).toBe('Done.');
  });

  it('runs a different call in a later pass, and still stops at the ceiling', async () => {
    const provider = scriptedProvider([
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [
          call('currency.convert', { amount: 10, fromCurrency: 'USD', toCurrency: 'EUR' }),
        ],
      },
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('budget.estimate', { destination: 'Lisbon', days: 4 })],
      },
      {
        text: '',
        provider: 'openai',
        model: 'gpt-test',
        toolCalls: [call('packing.list', { destination: 'Lisbon', days: 4 })],
      },
      { text: 'Done.', provider: 'openai', model: 'gpt-test' },
    ]);

    const turn = await completeTurn(request('convert 10 USD to EUR for Lisbon'), {
      provider,
      ctx,
      toolRounds: 3,
    });

    expect(turn.toolResults.map((result) => result.name)).toEqual([
      'currency.convert',
      'budget.estimate',
      'packing.list',
    ]);
    expect(turn.reply).toBe('Done.');
  });
});
