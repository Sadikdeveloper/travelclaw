import { describe, expect, it, vi } from 'vitest';
import {
  canReplayBody,
  FetchTimeoutError,
  fetchWithRetry,
  isRetryableStatus,
  isTransientFetchError,
  retryAfterMs,
} from './http';

/** Answers in order, then keeps answering with the last one. */
function fetchResponding(...responses: Response[]) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return responses[Math.min(calls.length - 1, responses.length - 1)]!;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A response whose body can be watched, to prove it is not left open. */
function cancellable(status: number) {
  const response = json({ error: 'upstream' }, status);
  const cancel = vi.spyOn(response.body!, 'cancel').mockResolvedValue(undefined);
  return { response, cancel };
}

function hang() {
  return (async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    })) as typeof fetch;
}

describe('isRetryableStatus', () => {
  it.each([408, 425, 429, 500, 502, 503, 504])('retries HTTP %i', (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    'answers HTTP %i instead of retrying it',
    (status) => {
      // 401 and 403 in particular: a vendor that refused the key is not going to
      // change its mind inside one turn, and retrying only spends the rate limit.
      expect(isRetryableStatus(status)).toBe(false);
    },
  );
});

describe('retryAfterMs', () => {
  it('reads seconds', () => {
    expect(retryAfterMs(json({}, 429, { 'Retry-After': '2' }))).toBe(2_000);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const response = json({}, 503, {
      'Retry-After': new Date(now + 5_000).toUTCString(),
    });
    expect(retryAfterMs(response, now)).toBe(5_000);
  });

  it('ignores a header it cannot read, and a date already in the past', () => {
    expect(retryAfterMs(json({}, 429, { 'Retry-After': 'soon' }))).toBeNull();
    expect(retryAfterMs(json({}, 429), Date.parse('2026-10-06T12:00:00Z'))).toBeNull();
    const past = json({}, 429, { 'Retry-After': 'Mon, 05 Oct 2026 12:00:00 GMT' });
    expect(retryAfterMs(past, Date.parse('2026-10-06T12:00:00Z'))).toBe(0);
  });
});

describe('canReplayBody', () => {
  it('accepts bodies that can be sent twice', () => {
    expect(canReplayBody(undefined)).toBe(true);
    expect(canReplayBody('{"a":1}')).toBe(true);
    expect(canReplayBody(new URLSearchParams({ q: 'lisbon' }))).toBe(true);
  });

  it('refuses a stream, which the first try would consume', () => {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => controller.close(),
    });
    expect(canReplayBody(stream)).toBe(false);
  });
});

describe('isTransientFetchError', () => {
  it('retries a socket that never answered or broke on the way', () => {
    expect(isTransientFetchError(new FetchTimeoutError())).toBe(true);
    const failed = new Error('fetch failed');
    failed.name = 'TypeError';
    expect(isTransientFetchError(failed)).toBe(true);
    expect(isTransientFetchError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe(
      true,
    );
    expect(isTransientFetchError(new Error('other side closed'))).toBe(true);
  });

  it('does not retry a redirect, which this desk refuses on purpose', () => {
    const redirected = new Error('Request was redirected');
    redirected.name = 'TypeError';
    expect(isTransientFetchError(redirected)).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('tries again when the vendor is busy, and answers with the retry', async () => {
    const { fetchImpl, calls } = fetchResponding(json({}, 503), json({ ok: true }));
    const response = await fetchWithRetry(
      fetchImpl,
      'https://fares.example/search',
      1_000,
      {},
      { attempts: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('closes the body it is not going to read', async () => {
    const first = cancellable(503);
    const { fetchImpl } = fetchResponding(first.response, json({ ok: true }));
    await fetchWithRetry(
      fetchImpl,
      'https://fares.example/search',
      1_000,
      {},
      {
        attempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
        jitter: 0,
      },
    );
    // An unconsumed body keeps the connection it rode in on, so a search that
    // fans out to four sources would hold four sockets open until the turn ended.
    expect(first.cancel).toHaveBeenCalled();
  });

  it('returns the last answer when the retries run out', async () => {
    const { fetchImpl, calls } = fetchResponding(json({ error: 'down' }, 503));
    const response = await fetchWithRetry(
      fetchImpl,
      'https://fares.example/search',
      1_000,
      {},
      {
        attempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
        jitter: 0,
      },
    );
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it('does not ask twice after a refusal', async () => {
    const { fetchImpl, calls } = fetchResponding(json({ error: 'no' }, 401));
    const response = await fetchWithRetry(
      fetchImpl,
      'https://fares.example/search',
      1_000,
      {},
      {
        attempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 2,
        jitter: 0,
      },
    );
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it('retries a source that hung, inside one budget', async () => {
    const calls: string[] = [];
    const fetchImpl = (async () => {
      calls.push('call');
      // Times out the first time, answers the second.
      if (calls.length === 1) {
        await new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 40),
        );
      }
      return json({ ok: true });
    }) as typeof fetch;

    const response = await fetchWithRetry(
      fetchImpl,
      'https://fares.example/search',
      20,
      {},
      {
        attempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
        deadlineMs: 500,
        jitter: 0,
      },
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('throws the last transport failure when no answer ever arrived', async () => {
    const calls: string[] = [];
    const fetchImplBoth = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      return hang()(url, init);
    }) as typeof fetch;
    await expect(
      fetchWithRetry(
        fetchImplBoth,
        'https://fares.example/search',
        20,
        {},
        {
          attempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 2,
          jitter: 0,
        },
      ),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(calls).toHaveLength(2);
  });

  it('waits as long as the vendor asked, when that fits the budget', async () => {
    const { fetchImpl, calls } = fetchResponding(
      json({}, 429, { 'Retry-After': '1' }),
      json({ ok: true }),
    );
    const startedAt = Date.now();
    const response = await fetchWithRetry(
      fetchImpl,
      'https://fares.example/search',
      1_000,
      {},
      {
        attempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2_000,
        deadlineMs: 5_000,
        jitter: 0,
      },
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(950);
  });

  it('gives up rather than waiting longer than it will ever wait', async () => {
    // An hour is an answer, not a schedule: a desk that waits it out has
    // stopped serving the traveler in front of it.
    const { fetchImpl, calls } = fetchResponding(json({}, 429, { 'Retry-After': '3600' }));
    const response = await fetchWithRetry(
      fetchImpl,
      'https://fares.example/search',
      1_000,
      {},
      {
        attempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 900,
        jitter: 0,
      },
    );
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it('sends a request it could not send twice exactly once', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => controller.close(),
    });
    const { fetchImpl, calls } = fetchResponding(json({}, 503));
    const response = await fetchWithRetry(
      fetchImpl,
      'https://fares.example/search',
      1_000,
      { method: 'POST', body: stream as unknown as BodyInit },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
    );
    // A streamed body is consumed by the first try: a second would send the
    // vendor half a request, or throw.
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(1);
  });

  it('stops when the traveler stops', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = fetchResponding(json({}, 503));
    await expect(
      fetchWithRetry(
        fetchImpl,
        'https://fares.example/search',
        1_000,
        {},
        {
          attempts: 3,
          baseDelayMs: 1,
          maxDelayMs: 2,
          jitter: 0,
          signal: controller.signal,
        },
      ),
    ).rejects.toBeTruthy();
  });
});
