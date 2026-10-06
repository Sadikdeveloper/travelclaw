import { readSessionToken } from './sessionToken';

export class ApiError extends Error {
  status: number;
  /** The gateway's error code, when it sent one (e.g. `rate_limited`). */
  code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type SessionRecovery = () => Promise<boolean>;

let recoverSession: SessionRecovery | null = null;

/**
 * Installed by `AuthProvider`: tries to restore a usable session after the gateway
 * rejected a cookie. Returns true when the caller may replay its request.
 */
export function setSessionRecovery(fn: SessionRecovery | null): void {
  recoverSession = fn;
}

/** A recovery that is already running, so several 401s at once spend one guest, not one each. */
let recoveryInFlight: Promise<boolean> | null = null;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  if (response.status === 401 && recoverSession && !path.startsWith('/api/auth/')) {
    // A guest whose cookie went stale is not a signed-out traveler. Restore the
    // session and replay the request once rather than showing a sign-in demand.
    // A 401 means the guard rejected before the handler ran, so the replay is safe.
    if (await restoreSession()) return parse<T>(await send(path, init));
  }
  return parse<T>(response);
}

/**
 * Restore a usable session after a 401, sharing one in-flight recovery so a
 * burst of failed requests spends one guest and not one each. Exported for the
 * streaming turn, which needs the same recovery before it replays its POST.
 */
export async function restoreSession(): Promise<boolean> {
  if (!recoverSession) return false;
  recoveryInFlight ??= recoverSession().finally(() => {
    recoveryInFlight = null;
  });
  return recoveryInFlight;
}

/** The headers every gateway call carries, including the cookie-free bearer copy. */
export function clientHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = readSessionToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function send(path: string, init?: RequestInit): Promise<Response> {
  // The cookie is the primary credential. The bearer token covers the embedded case where
  // the browser stores the cookie and never sends it back.
  return fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...clientHeaders(),
      ...init?.headers,
    },
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string };
    message?: string;
  };
  if (!response.ok) {
    const message = body.error?.message || body.message || response.statusText;
    throw new ApiError(message, response.status, body.error?.code);
  }
  return body as T;
}
