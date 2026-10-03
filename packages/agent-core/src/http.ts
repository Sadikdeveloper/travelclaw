/**
 * The three things every connector call shares. Kept in one place so a tool and
 * a desk search cannot drift on how an operator key is carried: the key travels
 * in a header, never in a URL, and a call that hangs is aborted rather than
 * leaving a turn open.
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
