import { Logger } from '@nestjs/common';
import type { ModelRecord } from '@travelclaw/shared';
import { ModelService } from '../src/models/model.service';

/**
 * A live model fails in ways that are nobody's fault: a rate limit, a deploy, a
 * socket dropped between two words. These tests are the edge cases a retry has
 * to survive — and the ones it must refuse to paper over.
 */

const flash: ModelRecord = {
  id: 'gemini-3.8-flash',
  label: 'Gemini 3.8 Flash',
  provider: 'google',
  tier: 'fast',
  limits: { guest: 5, account: 30 },
  offline: false,
  available: true,
};

const ENVIRONMENT = { ...process.env };
const REAL_FETCH = global.fetch;

/** One SSE frame carrying text, the shape an OpenAI-compatible stream sends. */
function sseFrame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** A stream that writes `chunks` and then closes. */
function streaming(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

/**
 * A stream that writes `chunks` and then breaks, as a dropped connection does.
 * The chunks are pulled one at a time so the first of them reaches the reader
 * before the break — an errored stream discards whatever it had queued.
 */
function brokenStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < chunks.length) {
          controller.enqueue(encoder.encode(chunks[sent]!));
          sent += 1;
          return;
        }
        controller.error(new Error('socket hang up'));
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * Answers with each response in turn; the last one repeats. Pass a function
 * when the same answer may be handed out twice: a `Response` body can only be
 * read once, and a real fetch returns a fresh object on every call.
 */
function fetchQueue(...responses: Array<Response | (() => Response)>) {
  const calls: string[] = [];
  global.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const answer = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return typeof answer === 'function' ? answer() : answer;
  }) as typeof fetch;
  return calls;
}

function service(): ModelService {
  return new ModelService();
}

describe('model call retries', () => {
  beforeEach(() => {
    Object.assign(process.env, {
      TRAVELCLAW_MODEL_PROVIDER: 'google',
      GEMINI_API_KEY: 'test-only-gemini-key',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
      TRAVELCLAW_MODEL_NAME: 'gemini-flash',
    });
    // The retries are the point of these tests; their warnings are not.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...ENVIRONMENT };
    global.fetch = REAL_FETCH;
    jest.restoreAllMocks();
  });

  it('answers with the real model after the upstream was briefly busy', async () => {
    const calls = fetchQueue(
      jsonResponse({ error: { message: 'overloaded' } }, 503),
      jsonResponse({ choices: [{ message: { content: 'Hello from Flash.' } }] }),
    );

    const completion = await service().providerFor(flash).complete({
      system: 'Be concise.',
      history: [],
      user: 'Hello',
      fallback: 'Desk fallback.',
    });

    expect(calls).toHaveLength(2);
    expect(completion).toMatchObject({
      text: 'Hello from Flash.',
      provider: 'google',
      model: 'gemini-3.8-flash',
    });
  });

  it('does not ask again after the provider refused the key', async () => {
    const calls = fetchQueue(jsonResponse({ error: { message: 'bad key' } }, 401));

    const completion = await service().providerFor(flash).complete({
      system: 'Be concise.',
      history: [],
      user: 'Hello',
      fallback: 'Desk fallback.',
    });

    // A rejected key is an answer. Retrying spends the operator's rate limit and
    // the traveler's time, and changes nothing.
    expect(calls).toHaveLength(1);
    expect(completion.text).toBe('Desk fallback.');
  });

  it('gives up asking for longer than it will ever wait', async () => {
    const calls = fetchQueue(
      jsonResponse({ error: { message: 'slow down' } }, 429, { 'Retry-After': '3600' }),
    );

    const completion = await service().providerFor(flash).complete({
      system: 'Be concise.',
      history: [],
      user: 'Hello',
      fallback: 'Desk fallback.',
    });

    expect(calls).toHaveLength(1);
    expect(completion.text).toBe('Desk fallback.');
  });

  it('falls back to the desk rendering once the retries are spent', async () => {
    const calls = fetchQueue(jsonResponse({ error: { message: 'down' } }, 503));

    const completion = await service().providerFor(flash).complete({
      system: 'Be concise.',
      history: [],
      user: 'Hello',
      fallback: 'Desk fallback.',
    });

    expect(calls).toHaveLength(3);
    expect(completion.text).toBe('Desk fallback.');
  });

  it('retries a stream that broke before it wrote a word, and writes it once', async () => {
    const calls = fetchQueue(
      new Response(new ReadableStream<Uint8Array>({ start: (c) => c.close() }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
      streaming([sseFrame('Hello'), sseFrame(' from Flash.')]),
    );

    const deltas: string[] = [];
    const completion = await service()
      .providerFor(flash)
      .complete({
        system: 'Be concise.',
        history: [],
        user: 'Hello',
        fallback: 'Desk fallback.',
        onDelta: (delta) => {
          if (delta.text) deltas.push(delta.text);
        },
      });

    expect(calls).toHaveLength(2);
    // The retry is invisible on the screen: the sentence is written once.
    expect(deltas.join('')).toBe('Hello from Flash.');
    expect(completion.text).toBe('Hello from Flash.');
  });

  it('keeps the words that arrived instead of restarting a stream mid-sentence', async () => {
    const calls = fetchQueue(brokenStream([sseFrame('Hello')]));

    const deltas: string[] = [];
    const completion = await service()
      .providerFor(flash)
      .complete({
        system: 'Be concise.',
        history: [],
        user: 'Hello',
        fallback: 'Desk fallback.',
        onDelta: (delta) => {
          if (delta.text) deltas.push(delta.text);
        },
      });

    // A second try would put the same words on the screen twice. The half
    // answer, with a line saying it stopped, is the honest one.
    expect(calls).toHaveLength(1);
    expect(completion.text).toBe('Hello');
    expect(deltas.join('')).toContain('Hello');
    // The note goes out as it is written, which is how the traveler reads it.
    expect(deltas.join('')).toContain('cut off');
  });

  it('asks once more when the model answers with nothing, and no more', async () => {
    const calls = fetchQueue(() =>
      jsonResponse({ choices: [{ message: { content: '' } }] }),
    );

    const completion = await service().providerFor(flash).complete({
      system: 'Be concise.',
      history: [],
      user: 'Hello',
      fallback: 'Desk fallback.',
    });

    // An empty choice is usually a failed upstream, so it is worth one more
    // ask. A second empty answer is answered by the desk instead of being paid
    // for a third time.
    expect(calls).toHaveLength(2);
    expect(completion.text).toBe('Desk fallback.');
  });

  it('never retries a turn the traveler stopped', async () => {
    const calls = fetchQueue(jsonResponse({ error: { message: 'down' } }, 503));
    const controller = new AbortController();
    controller.abort();

    await expect(
      service().providerFor(flash).complete({
        system: 'Be concise.',
        history: [],
        user: 'Hello',
        fallback: 'Desk fallback.',
        signal: controller.signal,
      }),
    ).rejects.toBeTruthy();

    expect(calls).toHaveLength(0);
  });
});
