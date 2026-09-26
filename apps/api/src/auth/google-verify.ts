import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';

/**
 * Verifies a Google Identity Services credential (a signed JWT) locally, against
 * Google's published signing keys — the way Google's own client libraries do it.
 *
 * The gateway previously called Google's `tokeninfo` endpoint per login. Google's own
 * docs call that endpoint unsuitable for production: it is rate-limited, adds a
 * network round trip (and an outage on Google's side) to every sign-in, and hands
 * verification to a debugging endpoint instead of checking the signature yourself.
 * Verifying locally needs only `node:crypto` (Node has supported importing a JWK
 * since v15.12) plus a small, short-lived cache of Google's public keys.
 */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;

export interface GoogleClaims {
  aud: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  sub: string;
}

export class GoogleTokenError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

export async function verifyGoogleIdToken(credential: string): Promise<GoogleClaims> {
  const parts = credential.split('.');
  if (parts.length !== 3) throw new GoogleTokenError('Malformed credential', 'malformed');

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeJson<Record<string, unknown>>(payloadB64);
  if (!header || !payload) {
    throw new GoogleTokenError('Malformed credential', 'malformed');
  }
  if (header.alg !== 'RS256' || !header.kid) {
    throw new GoogleTokenError('Unexpected signing algorithm', 'malformed');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const iat = typeof payload.iat === 'number' ? payload.iat : 0;
  if (exp <= now - CLOCK_SKEW_SEC) {
    throw new GoogleTokenError('Credential has expired', 'expired');
  }
  if (iat > now + CLOCK_SKEW_SEC) {
    throw new GoogleTokenError('Credential is not valid yet', 'not_yet_valid');
  }
  if (typeof payload.iss !== 'string' || !ISSUERS.has(payload.iss)) {
    throw new GoogleTokenError('Unexpected issuer', 'bad_issuer');
  }

  const key = await findKey(header.kid);
  if (!key) {
    throw new GoogleTokenError('No matching Google signing key', 'unknown_key');
  }

  const signed = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, 'base64url');
  const ok = verifySignature('RSA-SHA256', signed, createPublicKey({ key, format: 'jwk' }), signature);
  if (!ok) throw new GoogleTokenError('Signature does not match', 'bad_signature');

  const email = typeof payload.email === 'string' ? payload.email : '';
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  const aud = typeof payload.aud === 'string' ? payload.aud : '';
  if (!email || !sub || !aud) {
    throw new GoogleTokenError('Credential is missing required claims', 'malformed');
  }

  return {
    aud,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: typeof payload.name === 'string' ? payload.name : null,
    sub,
  };
}

async function findKey(kid: string): Promise<JsonWebKey | undefined> {
  const cached = jwksCache;
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    const hit = cached.keys.find((key) => (key as { kid?: string }).kid === kid);
    if (hit) return hit;
  }
  // Miss (including a key rotated since our last fetch) — refresh once and retry.
  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new GoogleTokenError('Could not fetch Google signing keys', 'jwks_unreachable');
  }
  const body = (await response.json()) as { keys: JsonWebKey[] };
  jwksCache = { keys: body.keys, fetchedAt: Date.now() };
  return jwksCache.keys.find((key) => (key as { kid?: string }).kid === kid);
}

function decodeJson<T>(base64url: string): T | null {
  try {
    return JSON.parse(Buffer.from(base64url, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** Test-only: lets a test install a fake, offline key set instead of calling Google. */
export function setGoogleJwksCacheForTests(keys: JsonWebKey[] | null): void {
  jwksCache = keys ? { keys, fetchedAt: Date.now() } : null;
}
