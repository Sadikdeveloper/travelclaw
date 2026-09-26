import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService } from '../src/auth/auth.service';
import { DatabaseService } from '../src/db/database.service';

describe('Google sign-in', () => {
  let db: DatabaseService;
  let auth: AuthService;
  const originalFetch = global.fetch;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-google-'));
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.TRAVELCLAW_GOOGLE_CLIENT_ID = 'the-real-client-id';
    process.env.TRAVELCLAW_NETWORK = '1';
    db = new DatabaseService();
    db.onModuleInit();
    auth = new AuthService(db);
  });

  afterAll(() => {
    db.onModuleDestroy();
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;
    global.fetch = originalFetch;
  });

  function mockGoogle(payload: Record<string, unknown>, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      json: async () => payload,
    }) as unknown as typeof fetch;
  }

  it('rejects a credential minted for a different client id', async () => {
    mockGoogle({
      aud: 'someone-elses-client-id',
      email: 'traveler@example.com',
      email_verified: 'true',
      sub: 'google-sub-1',
    });
    await expect(auth.loginWithGoogle('token')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects an unverified email', async () => {
    mockGoogle({
      aud: 'the-real-client-id',
      email: 'traveler@example.com',
      email_verified: 'false',
      sub: 'google-sub-1',
    });
    await expect(auth.loginWithGoogle('token')).rejects.toMatchObject({ status: 401 });
  });

  it('creates a new account on first sign-in and reuses it on the next', async () => {
    mockGoogle({
      aud: 'the-real-client-id',
      email: 'newtraveler@example.com',
      email_verified: true,
      name: 'New Traveler',
      sub: 'google-sub-2',
    });
    const first = await auth.loginWithGoogle('token');
    expect(first.user.email).toBe('newtraveler@example.com');
    expect(first.user.hasGoogle).toBe(true);
    expect(first.user.hasPassword).toBe(false);

    const second = await auth.loginWithGoogle('token');
    expect(second.user.id).toBe(first.user.id);
  });

  it('links to an existing password account with the same verified email', async () => {
    const registered = auth.register('linkme@example.com', 'a very good passphrase');
    expect(registered.user.hasGoogle).toBe(false);

    mockGoogle({
      aud: 'the-real-client-id',
      email: 'linkme@example.com',
      email_verified: true,
      sub: 'google-sub-3',
    });
    const linked = await auth.loginWithGoogle('token');
    expect(linked.user.id).toBe(registered.user.id);
    expect(linked.user.hasGoogle).toBe(true);
    expect(linked.user.hasPassword).toBe(true);
  });
});
