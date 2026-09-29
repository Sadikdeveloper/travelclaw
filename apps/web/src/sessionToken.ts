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

/**
 * The token for this page load, held in memory first. `localStorage` is the durable copy,
 * but a cross-site frame can refuse it outright — and a token that only ever lived there
 * would be missing from every request that follows, which reads to the gateway as a fresh
 * anonymous caller each time.
 */
let memoryToken: string | null = null;

export function readSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked outright (some embedded and private contexts).
    return null;
  }
}

export function storeSessionToken(token: string | undefined): void {
  if (!token) return;
  memoryToken = token;
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // The cookie, or the gateway's own memory of this browser, still covers us.
  }
}

export function clearSessionToken(): void {
  memoryToken = null;
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
