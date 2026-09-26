import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthService } from '../src/auth/auth.service';
import { DatabaseService } from '../src/db/database.service';

interface UserRow {
  id: string;
  is_guest: number;
}

interface SessionRow {
  id: string;
  user_id: string;
}

describe('guest accounts', () => {
  let db: DatabaseService;
  let auth: AuthService;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-guest-'));
    process.env.DATABASE_PATH = join(dir, 'test.db');
    db = new DatabaseService();
    db.onModuleInit();
    auth = new AuthService(db);
  });

  afterAll(() => {
    db.onModuleDestroy();
  });

  it('creates a guest with no password, no Google id, and isGuest true', async () => {
    const result = await auth.createGuest();
    expect(result.user.isGuest).toBe(true);
    expect(result.user.hasPassword).toBe(false);
    expect(result.user.hasGoogle).toBe(false);
  });

  it('promotes a guest into a real account on register, keeping its chats', async () => {
    const guest = await auth.createGuest();
    db.run(
      `INSERT INTO sessions (id, key, user_id, agent_id, channel, peer_id, title, created_at, updated_at)
       VALUES ('s1', 'agent:marlow:webchat:g1', ?, 'marlow', 'webchat', 'g1', 'Guest chat', '2026-01-01', '2026-01-01')`,
      guest.user.id,
    );

    const registered = await auth.register(
      'promoted@example.com',
      'a very good passphrase',
      'Promoted',
      guest.user.id,
    );

    // Same row, now a full account — the chat never had to move.
    expect(registered.user.id).toBe(guest.user.id);
    expect(registered.user.isGuest).toBe(false);
    expect(registered.user.hasPassword).toBe(true);
    expect(registered.user.email).toBe('promoted@example.com');

    const session = db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', 's1');
    expect(session?.user_id).toBe(guest.user.id);
  });

  it('folds a guest\u2019s chats into an existing account on login', async () => {
    await auth.register('owner@example.com', 'the real passphrase');
    const owner = db.get<UserRow>('SELECT * FROM users WHERE email = ?', 'owner@example.com');
    expect(owner).toBeTruthy();

    const guest = await auth.createGuest();
    db.run(
      `INSERT INTO sessions (id, key, user_id, agent_id, channel, peer_id, title, created_at, updated_at)
       VALUES ('s2', 'agent:marlow:webchat:g2', ?, 'marlow', 'webchat', 'g2', 'Guest chat 2', '2026-01-01', '2026-01-01')`,
      guest.user.id,
    );

    const signedIn = await auth.login('owner@example.com', 'the real passphrase', guest.user.id);
    expect(signedIn.user.id).toBe(owner!.id);

    const session = db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', 's2');
    expect(session?.user_id).toBe(owner!.id);

    // The guest row is gone — its chats live on the account now.
    const stillGuest = db.get<UserRow>('SELECT * FROM users WHERE id = ?', guest.user.id);
    expect(stillGuest).toBeUndefined();
  });

  it('leaves the guest and its chats alone when the sign-in attempt fails', async () => {
    await auth.register('careful@example.com', 'the correct passphrase');
    const guest = await auth.createGuest();
    db.run(
      `INSERT INTO sessions (id, key, user_id, agent_id, channel, peer_id, title, created_at, updated_at)
       VALUES ('s3', 'agent:marlow:webchat:g3', ?, 'marlow', 'webchat', 'g3', 'Guest chat 3', '2026-01-01', '2026-01-01')`,
      guest.user.id,
    );

    await expect(
      auth.login('careful@example.com', 'the wrong passphrase', guest.user.id),
    ).rejects.toMatchObject({ status: 401 });

    const session = db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', 's3');
    expect(session?.user_id).toBe(guest.user.id);
    const stillGuest = db.get<UserRow>('SELECT * FROM users WHERE id = ?', guest.user.id);
    expect(stillGuest?.is_guest).toBe(1);
  });
});
