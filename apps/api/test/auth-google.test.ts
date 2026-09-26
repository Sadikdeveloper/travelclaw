import { generateKeyPairSync, sign as signWithKey } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService } from '../src/auth/auth.service';
import { setGoogleJwksCacheForTests } from '../src/auth/google-verify';
import { DatabaseService } from '../src/db/database.service';

const KID = 'test-key-1';

// Local RSA keypair standing in for Google's — the whole point of the fix under test
// is that verification happens against a JWKS-shaped public key, not a live network
// call to Google, so tests exercise the real signature-checking code path offline.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function makeCredential(claims: Record<string, unknown>, opts: { kid?: string; alg?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const payload = {
    iss: 'https://accounts.google.com',
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = signWithKey('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
  return `${headerB64}.${payloadB64}.${base64url(signature)}`;
}

describe('Google sign-in', () => {
  let db: DatabaseService;
  let auth: AuthService;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-google-'));
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.TRAVELCLAW_GOOGLE_CLIENT_ID = 'the-real-client-id';
    process.env.TRAVELCLAW_NETWORK = '1';
    db = new DatabaseService();
    db.onModuleInit();
    auth = new AuthService(db);
  });

  beforeEach(() => {
    // Stand in for Google's JWKS endpoint so no test makes a real network call.
    setGoogleJwksCacheForTests([publicJwk as never]);
  });

  afterAll(() => {
    db.onModuleDestroy();
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;
    setGoogleJwksCacheForTests(null);
  });

  it('rejects a credential minted for a different client id', async () => {
    const token = makeCredential({
      aud: 'someone-elses-client-id',
      email: 'traveler@example.com',
      email_verified: true,
      sub: 'google-sub-1',
    });
    await expect(auth.loginWithGoogle(token)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an unverified email', async () => {
    const token = makeCredential({
      aud: 'the-real-client-id',
      email: 'traveler@example.com',
      email_verified: false,
      sub: 'google-sub-1',
    });
    await expect(auth.loginWithGoogle(token)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a signature that does not match the claimed key', async () => {
    const token = makeCredential({
      aud: 'the-real-client-id',
      email: 'traveler@example.com',
      email_verified: true,
      sub: 'google-sub-1',
    });
    const tampered = token.slice(0, -4) + 'aaaa';
    await expect(auth.loginWithGoogle(tampered)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an expired credential', async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
    const payload = {
      iss: 'https://accounts.google.com',
      iat: now - 7200,
      exp: now - 3600,
      aud: 'the-real-client-id',
      email: 'traveler@example.com',
      email_verified: true,
      sub: 'google-sub-1',
    };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signature = signWithKey('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
    const token = `${headerB64}.${payloadB64}.${base64url(signature)}`;
    await expect(auth.loginWithGoogle(token)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an untrusted issuer', async () => {
    const token = makeCredential({
      iss: 'https://evil.example.com',
      aud: 'the-real-client-id',
      email: 'traveler@example.com',
      email_verified: true,
      sub: 'google-sub-1',
    });
    await expect(auth.loginWithGoogle(token)).rejects.toMatchObject({ status: 401 });
  });

  it('creates a new account on first sign-in and reuses it on the next', async () => {
    const claims = {
      aud: 'the-real-client-id',
      email: 'newtraveler@example.com',
      email_verified: true,
      name: 'New Traveler',
      sub: 'google-sub-2',
    };
    const first = await auth.loginWithGoogle(makeCredential(claims));
    expect(first.user.email).toBe('newtraveler@example.com');
    expect(first.user.hasGoogle).toBe(true);
    expect(first.user.hasPassword).toBe(false);

    const second = await auth.loginWithGoogle(makeCredential(claims));
    expect(second.user.id).toBe(first.user.id);
  });

  it('links to an existing password account with the same verified email', async () => {
    const registered = await auth.register('linkme@example.com', 'a very good passphrase');
    expect(registered.user.hasGoogle).toBe(false);

    const token = makeCredential({
      aud: 'the-real-client-id',
      email: 'linkme@example.com',
      email_verified: true,
      sub: 'google-sub-3',
    });
    const linked = await auth.loginWithGoogle(token);
    expect(linked.user.id).toBe(registered.user.id);
    expect(linked.user.hasGoogle).toBe(true);
    expect(linked.user.hasPassword).toBe(true);
  });
});
