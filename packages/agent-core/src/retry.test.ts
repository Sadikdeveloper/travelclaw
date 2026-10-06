import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  DEFAULT_RETRY_POLICY,
  isAbortError,
  retryPolicy,
  sleep,
  withRetry,
} from './retry';

/** A clock the tests move by hand, so a deadline is tested without waiting for it. */
function clock() {
  let at = 0;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

/** Fails `times` times, then answers. Records how long each attempt thought it had. */
function flaky<T>(times: number, value: T, time = clock()) {
  const attempts: number[] = [];
  const operation = async ({ attempt }: { attempt: number; remainingMs: number }) => {
    attempts.push(attempt);
    time.advance(10);
    if (attempt < times) throw new Error(`attempt ${attempt} failed`);
    return value;
  };
  return { operation, attempts };
}

describe('backoffMs', () => {
  const fixed = retryPolicy({
    attempts: 8,
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    jitter: 0,
  });

  it('doubles, and stops growing at the ceiling', () => {
    expect([1, 2, 3, 4, 5, 6].map((attempt) => backoffMs(attempt, fixed))).toEqual([
      100, 200, 400, 800, 1_000, 1_000,
    ]);
  });

  it('spreads a pause over its jitter window instead of retrying on a fixed beat', () => {
    const policy = retryPolicy({ baseDelayMs: 400, maxDelayMs: 400, jitter: 0.5 });
    // Equal jitter: half of the pause is fixed, half is the coin. Two sources
    // that failed at the same moment cannot come back at the same moment.
    expect(backoffMs(1, policy, () => 0)).toBe(200);
    expect(backoffMs(1, policy, () => 1)).toBe(400);
  });

  it('never retries instantly', () => {
    const policy = retryPolicy({ baseDelayMs: 400, jitter: 0.5 });
    expect(backoffMs(1, policy, () => 0)).toBeGreaterThan(0);
  });
});

describe('retryPolicy', () => {
  it('clamps a policy into range', () => {
    expect(retryPolicy({ attempts: 0 })).toMatchObject({ attempts: 1 });
    expect(retryPolicy({ attempts: 2.7 })).toMatchObject({ attempts: 2 });
    expect(retryPolicy({ baseDelayMs: 500, maxDelayMs: 100 })).toMatchObject({
      maxDelayMs: 500,
    });
    expect(retryPolicy({ jitter: -1 }).jitter).toBe(0);
    expect(retryPolicy({ jitter: 4 }).jitter).toBe(1);
    expect(retryPolicy({ deadlineMs: -1 }).deadlineMs).toBe(0);
  });

  it('fills in what a call site left out', () => {
    expect(retryPolicy({ attempts: 2 })).toEqual({ ...DEFAULT_RETRY_POLICY, attempts: 2 });
  });
});

describe('isAbortError', () => {
  it('knows Stop, and only Stop', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(timeout)).toBe(true);
    expect(isAbortError(new Error('socket hang up'))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('withRetry', () => {
  it('answers on the first try and reports no waiting', async () => {
    const { operation } = flaky(0, 'ok');
    const outcome = await withRetry(operation, { attempts: 3 });
    expect(outcome).toMatchObject({ ok: true, value: 'ok', attempts: 1, waitedMs: 0 });
  });

  it('retries a transient failure and says how many tries it took', async () => {
    const { operation } = flaky(2, 'ok');
    const waits: number[] = [];
    const outcome = await withRetry(operation, {
      attempts: 3,
      baseDelayMs: 50,
      jitter: 0,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(outcome).toMatchObject({ ok: true, value: 'ok', attempts: 3, waitedMs: 150 });
    expect(waits).toEqual([50, 100]);
  });

  it('stops at the attempt ceiling and hands back the last failure', async () => {
    const { operation } = flaky(99, 'never');
    const outcome = await withRetry(operation, {
      attempts: 2,
      baseDelayMs: 1,
      jitter: 0,
      wait: async () => {},
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.attempts).toBe(2);
    expect(outcome.aborted).toBe(false);
    expect((outcome.error as Error).message).toBe('attempt 1 failed');
  });

  it('leaves a permanent failure alone', async () => {
    const { operation } = flaky(99, 'never');
    const outcome = await withRetry(operation, {
      attempts: 3,
      shouldRetry: () => false,
      wait: async () => {},
    });
    expect(outcome).toMatchObject({ ok: false, attempts: 1 });
  });

  it('never retries Stop, even with tries left', async () => {
    const controller = new AbortController();
    const { operation } = flaky(99, 'never');
    const outcome = await withRetry(operation, {
      attempts: 3,
      signal: controller.signal,
      wait: async () => {},
    });
    controller.abort();
    const second = await withRetry(operation, {
      attempts: 3,
      signal: controller.signal,
      wait: async () => {},
    });
    expect(outcome.attempts).toBe(3);
    expect(second).toMatchObject({ ok: false, aborted: true, attempts: 0, waitedMs: 0 });
  });

  it('does not wait before it gives up when the pause will not fit the budget', async () => {
    const time = clock();
    // An attempt that used most of the budget: only 300ms of it is left.
    const operation = async () => {
      time.advance(700);
      throw new Error('too slow');
    };
    let waited = 0;
    const outcome = await withRetry(operation, {
      attempts: 3,
      baseDelayMs: 400,
      maxDelayMs: 400,
      deadlineMs: 1_000,
      jitter: 0,
      now: time.now,
      wait: async (ms) => {
        waited += ms;
        time.advance(ms);
      },
    });
    // 700ms spent on the attempt, 300ms left: a 400ms pause would leave the next
    // try to be cut off before it answered, so the answer is given up instead.
    expect(outcome).toMatchObject({ ok: false, attempts: 1 });
    expect(waited).toBe(0);
  });

  it('honours a vendor’s own schedule over its own backoff', async () => {
    const { operation } = flaky(1, 'ok');
    const waits: number[] = [];
    const outcome = await withRetry(operation, {
      attempts: 2,
      baseDelayMs: 50,
      maxDelayMs: 5_000,
      jitter: 0,
      delayFor: () => 2_000,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(outcome).toMatchObject({ ok: true, attempts: 2, waitedMs: 2_000 });
    expect(waits).toEqual([2_000]);
  });

  it('reports a failure as aborted when Stop arrives during the pause', async () => {
    const controller = new AbortController();
    const { operation } = flaky(99, 'never');
    const outcome = await withRetry(operation, {
      attempts: 3,
      baseDelayMs: 10,
      jitter: 0,
      signal: controller.signal,
      wait: async (_ms, signal) => {
        controller.abort();
        await sleep(10, signal);
      },
    });
    expect(outcome).toMatchObject({ ok: false, aborted: true, attempts: 1 });
    expect(outcome.ok ? null : (outcome.error as Error).message).toBe('attempt 0 failed');
  });
});

describe('sleep', () => {
  it('waits about as long as it was asked to', async () => {
    const startedAt = Date.now();
    await sleep(20);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

  it('ends the moment the traveler stops, rather than waiting out the pause', async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeTruthy();
  });

  it('resolves at once when there is nothing to wait for', async () => {
    const controller = new AbortController();
    controller.abort();
    // Already stopped, but a zero-length pause has nothing to cancel.
    await expect(sleep(0, controller.signal)).resolves.toBeUndefined();
  });
});
