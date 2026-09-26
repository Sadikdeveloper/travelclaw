import { createHash, randomBytes } from 'node:crypto';

/** Raw token goes in the cookie. Only its hash is ever written to disk. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The raw session token for a request: the cookie first, then `Authorization: Bearer`.
 * The header exists for clients whose cookies do not survive — the control UI runs in an
 * embedded preview and inside cross-site iframes, where a `SameSite=Lax` cookie is set but
 * never sent back. Cookies stay the primary path; the header never overrides one.
 */
export function sessionTokenOf(
  headers: { cookie?: string; authorization?: string },
  cookieName: string,
): string | undefined {
  const fromCookie = parseCookies(headers.cookie)[cookieName];
  if (fromCookie) return fromCookie;
  const match = /^Bearer\s+(\S+)$/i.exec((headers.authorization || '').trim());
  return match?.[1];
}

/** No `cookie-parser` dependency for a one-line header split. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    const value = part.slice(eq + 1).trim();
    try {
      jar[key] = decodeURIComponent(value);
    } catch {
      jar[key] = value;
    }
  }
  return jar;
}
