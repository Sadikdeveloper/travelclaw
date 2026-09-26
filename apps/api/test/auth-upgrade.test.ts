import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService } from '../src/auth/auth.service';
import { hashPasswordLegacyScryptForTests, isLegacyScryptHash } from '../src/auth/password';
import { DatabaseService } from '../src/db/database.service';

interface UserRow {
  id: string;
  password_hash: string | null;
}

describe('legacy hash upgrade on login', () => {
  let db: DatabaseService;
  let auth: AuthService;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-upgrade-'));
    process.env.DATABASE_PATH = join(dir, 'test.db');
    db = new DatabaseService();
    db.onModuleInit();
    auth = new AuthService(db);
  });

  afterAll(() => {
    db.onModuleDestroy();
  });

  it('accepts an account whose hash predates Argon2id, then quietly re-hashes it', async () => {
    const email = 'oldschool@example.com';
    const password = 'a passphrase from before the upgrade';
    const legacyHash = hashPasswordLegacyScryptForTests(password);
    expect(isLegacyScryptHash(legacyHash)).toBe(true);

    db.run(
      `INSERT INTO users (id, email, password_hash, display_name, google_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      'legacy-user-1',
      email,
      legacyHash,
      'Old School',
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z',
    );

    const before = db.get<UserRow>('SELECT id, password_hash FROM users WHERE email = ?', email);
    expect(isLegacyScryptHash(before?.password_hash)).toBe(true);

    const result = await auth.login(email, password);
    expect(result.user.email).toBe(email);

    const after = db.get<UserRow>('SELECT id, password_hash FROM users WHERE email = ?', email);
    expect(isLegacyScryptHash(after?.password_hash)).toBe(false);
    expect(after?.password_hash?.startsWith('$argon2id$')).toBe(true);

    // The upgraded hash still authenticates the same password on a later login.
    const second = await auth.login(email, password);
    expect(second.user.email).toBe(email);
  });

  it('rejects the wrong password against a legacy hash without upgrading it', async () => {
    const email = 'oldschool2@example.com';
    const password = 'the real one';
    const legacyHash = hashPasswordLegacyScryptForTests(password);
    db.run(
      `INSERT INTO users (id, email, password_hash, display_name, google_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      'legacy-user-2',
      email,
      legacyHash,
      'Old School Two',
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z',
    );

    await expect(auth.login(email, 'not the real one')).rejects.toMatchObject({ status: 401 });

    const after = db.get<UserRow>('SELECT id, password_hash FROM users WHERE email = ?', email);
    expect(after?.password_hash).toBe(legacyHash);
  });
});
