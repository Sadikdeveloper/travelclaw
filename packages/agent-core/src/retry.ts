/**
 * One retry engine, shared by every outbound call the desk makes.
 *
 * A turn is a chain — the model, then the tools it asked for, then a provider
 * or two — and every link in it is a network call that can fail for a second:
 * a rate limit, a deploy, a socket dropped in transit. The turn is only as good
 * as its weakest link, and before this file each link failed once and gave up,
 * so one upstream 503 turned a live answer into a desk rendering.
 *
 * A retry has to get six things right, in this order:
 *
 * 1. **Stop means stop.** A traveler who pressed Stop is not waiting for a
 *    second try, and a cancelled turn may not leave a timer behind.
 * 2. **A permanent answer is not a slow one.** 401, 403 and 404 are the
 *    vendor's decision. Retrying them spends the traveler's time twice and
 *    spends the operator's rate limit as well.
 * 3. **What the vendor asked for wins.** `Retry-After` is honored, but capped:
 *    a desk that waits an hour has stopped serving the person in front of it,
 *    so a wait longer than the cap is a refusal, not a schedule.
 * 4. **The budget is wall-clock, not a count.** Two attempts that each take
 *    nine seconds are eighteen seconds of waiting, so one deadline covers
 *    every attempt *and* every pause between them.
 * 5. **Retries are jittered.** The desk queries several sources at once. If
 *    they failed together, they must not all come back together.
 * 6. **A state-changing request is never retried blindly.** Losing a hold is
 *    inconvenient; creating two is not. See `providers.ts` and the browser
 *    worker, which deliberately do not use this engine.
 *
 * The engine never throws: a caller gets `ok: false` and the last error, and
 * decides what a failure means for its own answer. `fetchWithRetry` in `./http`
 * is the fetch-shaped wrapper over it.
 */

/** One call's pace: how many tries, how long between them, and the total budget. */
export interface RetryPolicy {
  /** Total tries, including the first. `1` disables retrying. */
  attempts: number;
  /** Pause before the second try; each further try doubles it, capped by `maxDelayMs`. */
  baseDelayMs: number;
  /** Upper bound on one pause. Also the cap on a vendor's `Retry-After`. */
  maxDelayMs: number;
  /** Wall-clock budget covering every try and every pause between them. */
  deadlineMs: number;
  /**
   * How much of a pause is randomized: `0` is a fixed delay, `1` spreads a
   * pause over the whole window. Half by default — never instantaneous, never
   * in lockstep with a parallel call that failed at the same moment.
   */
  jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 150,
  maxDelayMs: 1_000,
  deadlineMs: 8_000,
  jitter: 0.5,
};

/** Fills in a partial policy and clamps it into range. */
export function retryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  const merged = { ...DEFAULT_RETRY_POLICY, ...overrides };
  const attempts = Math.floor(merged.attempts);
  const baseDelayMs = Math.max(0, merged.baseDelayMs);
  const maxDelayMs = Math.max(0, merged.maxDelayMs);
  return {
    attempts: Number.isFinite(attempts) ? Math.max(1, attempts) : 1,
    baseDelayMs: Number.isFinite(baseDelayMs) ? baseDelayMs : 0,
    maxDelayMs: Number.isFinite(maxDelayMs)
      ? Math.max(baseDelayMs, maxDelayMs)
      : baseDelayMs,
    deadlineMs: Number.isFinite(merged.deadlineMs) ? Math.max(0, merged.deadlineMs) : 0,
    jitter: Math.min(1, Math.max(0, merged.jitter)),
  };
}

/**
 * How long to wait after `attempt` failed (1-based: `1` is the first failure).
 * Exponential, capped, then jittered so a fan-out of sources that failed
 * together does not retry together.
 */
export function backoffMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const growth = 2 ** Math.max(0, attempt - 1);
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * growth);
  if (!Number.isFinite(ceiling) || ceiling <= 0) return 0;
  if (!policy.jitter) return Math.round(ceiling);
  const fixed = ceiling * (1 - policy.jitter);
  return Math.round(fixed + ceiling * policy.jitter * random());
}

/** Stop, and the timeout a call sets on itself, are not failures to retry. */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** The reason a signal carries, or an `AbortError` when it was aborted bare. */
export function abortError(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * A pause that ends early when the traveler stops the turn, and never holds the
 * process open on its own.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const settled = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      settled();
      reject(abortError(signal!));
    };
    timer = setTimeout(() => {
      settled();
      resolve();
    }, ms);
    // A retry that is waiting must not be the reason the process is still up.
    (timer as { unref?: () => void }).unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** What the engine tells `onRetry` about the try that just failed. */
export interface RetryAttemptInfo {
  /** 1-based: the try that just failed. */
  attempt: number;
  error: unknown;
  /** The pause that follows, in ms. Absent when the budget had no room for one. */
  delayMs: number;
  /** Wall-clock ms left in the budget. */
  remainingMs: number;
}

export interface WithRetryOptions extends Partial<RetryPolicy> {
  /** Stop. Checked before every try and honoured during every pause. */
  signal?: AbortSignal;
  /** Whether a failure deserves another try. Aborts are never retried. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /**
   * A vendor's own schedule, when the failure came with one (`Retry-After`).
   * Returned in ms; the engine clamps it to `maxDelayMs` and to the budget.
   */
  delayFor?: (error: unknown) => number | null | undefined;
  onRetry?: (info: RetryAttemptInfo) => void;
  /** Injected in tests: the clock, the coin, and the pause. */
  now?: () => number;
  random?: () => number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** What one try receives: its index (0-based) and the budget it has left. */
export interface RetryAttemptContext {
  attempt: number;
  remainingMs: number;
}

export type RetryOutcome<T> =
  | { ok: true; value: T; attempts: number; waitedMs: number }
  | { ok: false; error: unknown; attempts: number; waitedMs: number; aborted: boolean };

/**
 * Run `operation` until it succeeds, the policy gives up, or the budget runs
 * out. Never throws: an abort is reported with `aborted: true` so a caller that
 * must propagate Stop can rethrow it itself.
 *
 * The default retries anything that is not an abort — pass `shouldRetry` for a
 * call that can fail permanently.
 */
export async function withRetry<T>(
  operation: (context: RetryAttemptContext) => Promise<T>,
  options: WithRetryOptions = {},
): Promise<RetryOutcome<T>> {
  const policy = retryPolicy(options);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  const random = options.random ?? Math.random;
  const startedAt = now();
  let waitedMs = 0;

  for (let attempt = 1; ; attempt += 1) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        error: abortError(options.signal),
        attempts: attempt - 1,
        waitedMs,
        aborted: true,
      };
    }
    let error: unknown;
    try {
      const value = await operation({
        attempt: attempt - 1,
        remainingMs: remaining(policy, startedAt, now),
      });
      return { ok: true, value, attempts: attempt, waitedMs };
    } catch (caught) {
      error = caught;
    }

    // Stop is a decision, not a failure. It is never retried and never waited on.
    if (isAbortError(error) || options.signal?.aborted) {
      return { ok: false, error, attempts: attempt, waitedMs, aborted: true };
    }
    const worthAnotherTry = options.shouldRetry
      ? options.shouldRetry(error, attempt)
      : true;
    if (attempt >= policy.attempts || !worthAnotherTry) {
      return { ok: false, error, attempts: attempt, waitedMs, aborted: false };
    }

    const remainingMs = remaining(policy, startedAt, now);
    const asked = options.delayFor?.(error);
    const delayMs =
      typeof asked === 'number' && Number.isFinite(asked)
        ? Math.min(Math.max(0, asked), policy.maxDelayMs)
        : backoffMs(attempt, policy, random);
    // A pause longer than the time left buys a try that would be cut off
    // mid-flight. Give the answer up instead of spending it.
    if (remainingMs <= delayMs) {
      return { ok: false, error, attempts: attempt, waitedMs, aborted: false };
    }
    options.onRetry?.({ attempt, error, delayMs, remainingMs });
    try {
      await wait(delayMs, options.signal);
      waitedMs += delayMs;
    } catch (waitError) {
      // Stopping during a pause ends the call: the failure it was pausing over
      // is the one the caller should see, with `aborted` saying why.
      return {
        ok: false,
        error: isAbortError(waitError) ? error : waitError,
        attempts: attempt,
        waitedMs,
        aborted: isAbortError(waitError),
      };
    }
  }
}

function remaining(policy: RetryPolicy, startedAt: number, now: () => number): number {
  return Math.max(0, policy.deadlineMs - (now() - startedAt));
}
