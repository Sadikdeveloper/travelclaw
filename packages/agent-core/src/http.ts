import { abortError, withRetry, type RetryPolicy, type WithRetryOptions } from './retry';

/**
 * The three things every connector call shares. Kept in one place so a tool and
 * a desk search cannot drift on how an operator key is carried: the key travels
 * in a header, never in a URL, and a call that hangs is aborted rather than
 * leaving a turn open.
 *
 * The retry wrapper lives here too, so a connector, a tool, and the public web
 * reader all retry the same way — see `./retry` for the rules.
 */

/**
 * A connector base URL from the operator's env. Defense in depth: only http(s)
 * is honored here, anything else falls back to the desk default, and a key is
 * never appended to a URL — headers only.
 */
export function connectorBase(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw.trim());
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return fallback;
    }
    // Query strings and fragments are not part of an API base URL. Removing
    // them avoids sending credentials to a malformed path by accident.
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

export function authHeaders(apiKey: string | undefined): Record<string, string> {
  const key = apiKey?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** A fare shop is a bigger question than a rate lookup, so it gets longer than a tool call. */
export const SEARCH_TIMEOUT_MS = 9000;

const NOT_JSON = Symbol('not-json');

/** A JSON body, or the symbol when the vendor answered with something else. */
export async function readJson(response: Response): Promise<unknown | typeof NOT_JSON> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return NOT_JSON;
  }
}

export { NOT_JSON };

/**
 * Defense in depth for vendors that require a credential somewhere other than a
 * header (one search API takes the key as a URL path segment). Every
 * developer-facing string an adapter returns goes through this, so the secret
 * cannot reach a summary, a log line, a task row, or a model prompt even if the
 * vendor echoes the request back in an error message.
 */
export function scrubSecrets(text: string, secrets: Array<string | undefined>): string {
  let clean = text;
  for (const secret of secrets) {
    const value = secret?.trim();
    if (!value || value.length < 6) continue;
    clean = clean.split(value).join('[redacted]');
  }
  return clean;
}

export class FetchTimeoutError extends Error {
  constructor() {
    super('Provider request timed out');
    this.name = 'FetchTimeoutError';
  }
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  ms: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new FetchTimeoutError());
      controller.abort();
    }, ms);
  });
  // The caller's own signal — usually the turn's Stop — is honoured as well as
  // the timeout: a stopped turn ends the call in flight, not just the wait for
  // the next one. Linked by hand rather than with `AbortSignal.any`, so this
  // works in any runtime the packages are loaded into.
  const external = init.signal;
  let onAbort: (() => void) | undefined;
  if (external) {
    if (external.aborted) controller.abort(abortError(external));
    else {
      onAbort = () => controller.abort(abortError(external));
      external.addEventListener('abort', onAbort, { once: true });
    }
  }
  try {
    return await Promise.race([
      fetchImpl(url, {
        ...init,
        redirect: init.redirect ?? 'error',
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer!);
    if (external && onAbort) external.removeEventListener('abort', onAbort);
  }
}

/** The host of a connector base URL, for naming a provider the payload did not name. */
export function providerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/* -------------------------------------------------------------------------- */
/* Retrying a fetch                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Statuses that mean "ask again". Everything else is an answer: a vendor that
 * rejected the key, refused the payload, or does not have the route is not
 * going to change its mind inside one turn.
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  408, // request timeout
  409, // conflict: OpenClaw's transient list; every call retried here is a read
  425, // too early: a TLS handshake retried before it was replayable
  429, // rate limited
  500,
  502,
  503,
  504, // the vendor, its gateway, or a proxy in between
]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * A retryable status, carrying the vendor's own schedule when it sent one.
 * Thrown inside `fetchWithRetry` so the retry engine can see a status as a
 * failure; it never escapes that function.
 */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

/**
 * What the other end asked us to wait, in ms: `retry-after-ms` first (the
 * millisecond spelling some gateways send), then `Retry-After` as seconds or an
 * HTTP date.
 *
 * `null` when there is no usable wait — absent, unreadable, zero, or a date
 * already in the past. An expired cooldown is not "retry now": Hermes treats it
 * as no information at all, because reading it as a zero-second wait hot-loops
 * the provider. The caller falls back to its own backoff instead.
 */
export function retryAfterMs(response: Response, now = Date.now()): number | null {
  const header = (name: string): string | null => {
    const value = response.headers?.get?.(name);
    return typeof value === 'string' ? value.trim() : null;
  };
  const milliseconds = header('retry-after-ms');
  if (milliseconds !== null && /^\d+(?:\.\d+)?$/.test(milliseconds)) {
    return positive(Number(milliseconds));
  }
  const seconds = header('retry-after');
  if (seconds === null || !seconds) return null;
  if (/^\d+(?:\.\d+)?$/.test(seconds)) return positive(Number(seconds) * 1_000);
  const at = Date.parse(seconds);
  if (!Number.isFinite(at)) return null;
  return positive(at - now);
}

function positive(ms: number): number | null {
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * Free-text pacing hints, the way Hermes reads them out of provider error
 * bodies: an explicit "retry after 300ms" wins over a quota's "resets in 4h",
 * because a body carrying both describes a short throttle inside a long window
 * and the shorter wait is the one the provider is actually asking for.
 */
const PACING_HINTS: Array<{
  pattern: RegExp;
  toMs: (match: RegExpMatchArray) => number | null;
}> = [
  {
    pattern:
      /retry(?:\s+after)?\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?)\b/i,
    toMs: (match) => scale(match),
  },
  {
    pattern:
      /try\s+again\s+in\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?)\b/i,
    toMs: (match) => scale(match),
  },
  {
    pattern: /quotaResetDelay["'\s:]+(\d+(?:\.\d+)?)\s*(ms|s)\b/i,
    toMs: (match) => scale(match),
  },
  {
    pattern: /resets_in_seconds\W{1,4}(\d+(?:\.\d+)?)/i,
    toMs: (match) => positive(Number(match[1]) * 1_000),
  },
  {
    pattern: /resets?\s+in\s+(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i,
    toMs: (match) => positive(Number(match[1]) * 3_600_000),
  },
];

/** `(\d+)(ms|s)` → ms. The unit is required, so "retry after 5" is not a wait. */
function scale(match: RegExpMatchArray): number | null {
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return positive(/^ms|milliseconds?$/i.test(match[2] ?? '') ? value : value * 1_000);
}

/**
 * The wait a provider asked for in the prose of an error message or body, in
 * ms, or `null` when it named none.
 */
export function retryAfterHintMs(message: string | null | undefined): number | null {
  if (typeof message !== 'string' || !message) return null;
  for (const hint of PACING_HINTS) {
    const match = hint.pattern.exec(message);
    if (!match) continue;
    const ms = hint.toMs(match);
    if (ms !== null) return ms;
  }
  return null;
}

/**
 * A bounded peek at an error body, taken only to read a pacing hint out of it.
 * Capped rather than `response.text()`, so a vendor that answers a 503 with a
 * hundred megabytes cannot turn one retry into an outage. Never logged and
 * never surfaced: providers echo request details in error bodies, and this
 * desk's rule is that a vendor's message is reported as a shape failure, not
 * repeated.
 */
export async function readPacingHint(
  response: Response,
  limit = 2_048,
): Promise<string | null> {
  const body = response.body;
  if (!body) return null;
  try {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (text.length < limit) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return text.slice(0, limit);
  } catch {
    return null;
  }
}

/** The wait a response asked for: its headers first, then the prose of its body. */
export function pacingMs(
  response: Response,
  body: string | null,
  now?: number,
): number | null {
  return retryAfterMs(response, now) ?? retryAfterHintMs(body);
}

/**
 * A transport failure worth another try: the socket never answered, or broke on
 * the way. A redirect is excluded on purpose — `redirect: 'error'` is this
 * desk's own refusal to follow one, and following it on a second try is not
 * what an operator configured.
 */
export function isTransientFetchError(error: unknown): boolean {
  if (error instanceof FetchTimeoutError) return true;
  if (!error || typeof error !== 'object') return false;
  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';
  if (/redirect/i.test(message)) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'TypeError' || name === 'FetchError') return true;
  return /ECONNRESET|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT|EHOSTDOWN|socket hang up|fetch failed|network is unreachable|other side closed|terminated|premature close/i.test(
    message,
  );
}

/**
 * Whether a request body can be sent twice. A stream — or a `FormData`
 * carrying one — is consumed by the first try, so a retry would either throw or
 * send a request the vendor never saw the whole of.
 */
export function canReplayBody(body: unknown): boolean {
  if (body === undefined || body === null) return true;
  if (typeof body === 'string' || body instanceof URLSearchParams) return true;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  return false;
}

/**
 * A rate or forecast lookup. Cheap, with a labeled desk fallback behind it, so
 * it will not sit long even if a vendor asks it to.
 */
export const LOOKUP_RETRY: Partial<RetryPolicy> = {
  attempts: 2,
  baseDelayMs: 120,
  maxDelayMs: 400,
  maxWaitMs: 1_000,
  deadlineMs: 5_200,
};

/** A fare, stay, or web search. The desk already waits seconds for one. */
export const SEARCH_RETRY: Partial<RetryPolicy> = {
  attempts: 2,
  baseDelayMs: 250,
  maxDelayMs: 900,
  maxWaitMs: 3_000,
  deadlineMs: 12_000,
};

export interface FetchRetryOptions extends WithRetryOptions {
  /** Which statuses deserve another try. Never widen this to 401 or 403. */
  retryOnStatus?: (status: number) => boolean;
  /** Overrides the check on `init.body`: `false` forces a single attempt. */
  replayable?: boolean;
}

/**
 * `fetchWithTimeout`, tried again when the failure is transient.
 *
 * Two things make this more than a loop around `fetch`:
 *
 * - A response that is going to be retried is **cancelled**, not dropped. An
 *   unconsumed body keeps the connection it rode in on, so a search that fans
 *   out to four sources would hold four sockets open until the turn ended.
 * - A request whose body cannot be sent twice is sent once. A half-sent search
 *   is worse than an unanswered one, and a streamed body would throw on the
 *   second try.
 *
 * Returns the last response when the status is an answer (including a retryable
 * one whose retries ran out), and throws the last transport error — a
 * `FetchTimeoutError`, or whatever `fetch` rejected with — when no response
 * ever arrived.
 */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  ms: number,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const { retryOnStatus = isRetryableStatus, ...retry } = options;
  const attempts = (options.replayable ?? canReplayBody(init.body)) ? undefined : 1;
  // Stop ends the attempt in flight, not only the wait before the next one.
  const request: RequestInit = retry.signal ? { ...init, signal: retry.signal } : init;
  let last: Response | null = null;

  const outcome = await withRetry<Response>(
    async ({ remainingMs }) => {
      const response = await fetchWithTimeout(
        fetchImpl,
        url,
        // The budget, not just the timeout, decides how long this try gets: a
        // second attempt that would be cut off is not worth starting.
        Math.max(1, Math.min(ms, remainingMs > 0 ? remainingMs : ms)),
        request,
      );
      if (retryOnStatus(response.status)) {
        last = response;
        // What the vendor asked for is worth reading before the body is
        // dropped: a 429 that says "try again in 300ms" is naming the wait the
        // desk is about to keep anyway.
        const wait = pacingMs(response, await readPacingHint(response));
        await response.body?.cancel().catch(() => {});
        throw new HttpStatusError(response.status, wait);
      }
      return response;
    },
    {
      ...retry,
      ...(attempts ? { attempts } : {}),
      shouldRetry: (error) =>
        error instanceof HttpStatusError ? true : isTransientFetchError(error),
      delayFor: (error) =>
        error instanceof HttpStatusError ? error.retryAfterMs : undefined,
    },
  );

  if (outcome.ok) return outcome.value;
  // A status the desk can report (429, 503, …) is a result, not an exception:
  // the call site already knows how to say which status came back.
  if (last) return last;
  throw outcome.error;
}
