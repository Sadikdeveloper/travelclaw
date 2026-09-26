import type { AuthSessionResponse, UserRecord } from '@travelclaw/shared';

/**
 * The session token, kept beside the cookie.
 *
 * The gateway's cookie is `SameSite=Lax` and HttpOnly, which is the better default. It is
 * also the thing that breaks when this app is embedded: in a cross-site iframe, or with
 * third-party cookies blocked, the browser accepts the `Set-Cookie` and then never sends it
 * back — so every request arrives anonymous, and a guest is re-provisioned on each page
 * load until the desk's guest cap trips. `apps/web/src/api.ts` sends this token as
 * `Authorization: Bearer` whenever the cookie is not doing the job.
 *
 * localStorage rather than sessionStorage: a preview that reloads the frame repeatedly must
 * reuse one guest session, not mint a new one each time.
 */
const KEY = 'travelclaw.sessionToken';

export function readSessionToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked outright (some embedded and private contexts).
    return null;
  }
}

export function storeSessionToken(token: string | undefined): void {
  if (!token) return;
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // Nothing to do: the cookie may still work.
  }
}

export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Already gone.
  }
}

/** Sign-in and guest routes return the token; `/api/auth/me` does not. */
export function storeTokenFrom(account: UserRecord | AuthSessionResponse | null): void {
  if (account && 'sessionToken' in account) storeSessionToken(account.sessionToken);
}
