import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { GUEST_MINTS_PER_IP_PER_HOUR } from '../src/auth/auth.service';
import { DatabaseService } from '../src/db/database.service';

describe('guest sessions over HTTP', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-guest-http-'));

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'mock';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  /** Guest rows, to prove a resume did not mint a new identity. */
  function countGuests(): number {
    const db = app.get(DatabaseService);
    return (
      db.get<{ c: number }>('SELECT COUNT(*) c FROM users WHERE is_guest = 1')?.c ?? -1
    );
  }

  afterAll(async () => {
    await app.close();
  });

  it('mints a guest with no signup and lets it use chat right away', async () => {
    const agent = request.agent(app.getHttpServer());
    // Each test is a different browser: same address, different user agent, so one test's
    // guest and its turn budget never bleed into the next.
    const guest = await agent
      .post('/api/auth/guest')
      .set('User-Agent', 'test/cookie-agent');
    expect(guest.status).toBe(200);
    expect(guest.body.isGuest).toBe(true);
    expect(guest.body.hasPassword).toBe(false);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(guest.body.id);

    const session = await agent.post('/api/sessions').send({ channel: 'webchat' });
    expect(session.status).toBe(201);

    const turn = await agent
      .post(`/api/sessions/${session.body.id}/messages`)
      .send({ content: 'hello from a guest' });
    expect(turn.status).toBe(201);
  });

  /**
   * The embedded case: the browser accepts Set-Cookie and never sends it back (a cross-site
   * iframe, or third-party cookies blocked). The token in the body is what keeps that client
   * from being re-provisioned on every request.
   */
  it('runs a whole session on the bearer token with no cookies at all', async () => {
    const fresh = request(app.getHttpServer());
    const minted = await fresh
      .post('/api/auth/guest')
      .set('User-Agent', 'test/bearer-only');
    expect(minted.status).toBe(200);
    expect(minted.body.sessionToken).toMatch(/^[\w-]{20,}$/);
    const auth = { Authorization: `Bearer ${minted.body.sessionToken}` };

    // No cookie jar in sight: every call carries only the header.
    const me = await request(app.getHttpServer()).get('/api/auth/me').set(auth);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(minted.body.id);

    const session = await request(app.getHttpServer())
      .post('/api/sessions')
      .set(auth)
      .send({ channel: 'webchat' });
    expect(session.status).toBe(201);

    const turn = await request(app.getHttpServer())
      .post(`/api/sessions/${session.body.id}/messages`)
      .set(auth)
      .send({ content: 'hello from a cookie-less browser' });
    expect(turn.status).toBe(201);
    expect(turn.body.message.role).toBe('assistant');

    // The reload path: the token resumes the same guest instead of minting another one.
    const before = countGuests();
    const again = await request(app.getHttpServer()).post('/api/auth/guest').set(auth);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(minted.body.id);
    expect(countGuests()).toBe(before);
  });

  it('prefers the cookie over a bearer token that disagrees with it', async () => {
    const agent = request.agent(app.getHttpServer());
    const mine = await agent.post('/api/auth/guest');
    const other = await request(app.getHttpServer())
      .post('/api/auth/guest')
      .set('User-Agent', 'test/other-browser');

    const me = await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${other.body.sessionToken}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(mine.body.id);
  });

  it('treats a stale bearer token as an expired session, not as a stranger', async () => {
    const stale = await request(app.getHttpServer())
      .post('/api/chat')
      .set('Authorization', 'Bearer a-token-that-was-never-issued')
      .send({ content: 'hi' });
    expect(stale.status).toBe(401);
    expect(stale.body.error.message).toMatch(/expired/i);
  });

  it('is idempotent: a second call with the same cookie returns the same guest', async () => {
    const agent = request.agent(app.getHttpServer());
    const first = await agent.post('/api/auth/guest');
    const second = await agent.post('/api/auth/guest');
    expect(second.body.id).toBe(first.body.id);
  });

  it('does not mint a fresh guest for someone already signed into a real account', async () => {
    const agent = request.agent(app.getHttpServer());
    const registered = await agent.post('/api/auth/register').send({
      email: `real-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'a very good passphrase',
    });
    expect(registered.status).toBe(201);

    const guestAttempt = await agent.post('/api/auth/guest');
    expect(guestAttempt.body.id).toBe(registered.body.id);
    expect(guestAttempt.body.isGuest).toBe(false);
  });

  it('tells an expired session apart from a caller that never had one', async () => {
    // No cookie: truly anonymous, which the control UI never lets a visitor be.
    const anonymous = await request(app.getHttpServer())
      .post('/api/chat')
      .set('User-Agent', 'test/never-seen-before')
      .send({ content: 'hi' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('unauthenticated');
    expect(anonymous.body.error.message).toBe('Sign in to use this.');

    // A cookie the desk no longer honours is a stale session, not a sign-in demand.
    const stale = await request(app.getHttpServer())
      .post('/api/chat')
      .set('Cookie', 'travelclaw_session=0123456789abcdef')
      .send({ content: 'hi' });
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('unauthenticated');
    expect(stale.body.error.message).toMatch(/expired/i);
    expect(stale.body.error.message).not.toMatch(/sign in to use/i);
  });

  it('rate-limits chat turns from a guest tighter than a signed-up account', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/guest').set('User-Agent', 'test/turn-pacer');
    const session = await agent.post('/api/sessions').send({ channel: 'webchat' });

    let last: { status: number; body: { error?: { code?: string; message?: string } } } = {
      status: 0,
      body: {},
    };
    for (let i = 0; i < 20; i += 1) {
      last = await agent
        .post(`/api/sessions/${session.body.id}/messages`)
        .send({ content: `turn ${i}` });
    }
    expect(last.status).toBe(429);
    expect(last.body.error?.code).toBe('rate_limited');
    expect(last.body.error?.message).toMatch(/wait a few minutes/i);
    expect(last.body.error?.message).toMatch(/sign in for a higher limit/i);
  });

  /**
   * The embedded case that has no client-side answer: a cross-site frame with third-party
   * cookies *and* storage blocked arrives with no cookie and no token on every request. It
   * must still be one visitor. Without this, each request mints a guest, the per-address
   * budget is gone in seconds, and the visitor is locked out of a desk they never used.
   */
  it('resumes one guest for a browser that can present no credential at all', async () => {
    const ua = 'test/cannot-keep-anything';
    const first = await request(app.getHttpServer())
      .post('/api/auth/guest')
      .set('User-Agent', ua);
    expect(first.status).toBe(200);
    const minted = countGuests();

    const me = await request(app.getHttpServer()).get('/api/auth/me').set('User-Agent', ua);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(first.body.id);

    const session = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('User-Agent', ua)
      .send({ channel: 'webchat' });
    expect(session.status).toBe(201);

    const turn = await request(app.getHttpServer())
      .post(`/api/sessions/${session.body.id}/messages`)
      .set('User-Agent', ua)
      .send({ content: 'hello from a frame that keeps nothing' });
    expect(turn.status).toBe(201);

    // Reload: /api/auth/me answers with the same guest, and no identity was spent.
    const reload = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('User-Agent', ua);
    expect(reload.body.id).toBe(first.body.id);
    expect(countGuests()).toBe(minted);
  });

  it('keeps two credential-less browsers apart by user agent', async () => {
    const mine = await request(app.getHttpServer())
      .post('/api/auth/guest')
      .set('User-Agent', 'test/browser-a');
    const other = await request(app.getHttpServer())
      .post('/api/auth/guest')
      .set('User-Agent', 'test/browser-b');
    expect(other.status).toBe(200);
    expect(other.body.id).not.toBe(mine.body.id);
  });

  it('treats a stale token as an ended session, never as a browser to resume', async () => {
    const ua = 'test/logged-out-elsewhere';
    await request(app.getHttpServer()).post('/api/auth/guest').set('User-Agent', ua);
    const stale = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('User-Agent', ua)
      .set('Authorization', 'Bearer a-token-that-was-never-issued');
    expect(stale.status).toBe(401);
    expect(stale.body.error.message).toMatch(/expired/i);
  });

  it('ends the remembered guest when the browser signs out', async () => {
    const ua = 'test/signs-out';
    const mine = await request(app.getHttpServer())
      .post('/api/auth/guest')
      .set('User-Agent', ua);
    const out = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('User-Agent', ua);
    expect(out.status).toBe(200);
    const next = await request(app.getHttpServer())
      .post('/api/auth/guest')
      .set('User-Agent', ua);
    expect(next.body.id).not.toBe(mine.body.id);
  });

  it('does not reflect an arbitrary origin back to a cross-site caller', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  /**
   * Last in this file on purpose: the guest-minting cap is per IP for an hour, so it
   * would starve every test above once tripped.
   */
  it('paces guest minting with a cooldown message, not a sign-in demand', async () => {
    // This visitor already holds a cookie. The cap below is about minting *new* guests,
    // and must not take the desk away from someone who is already using it.
    const agent = request.agent(app.getHttpServer());
    const mine = await agent.post('/api/auth/guest').set('User-Agent', 'test/pace-holder');
    expect(mine.status).toBe(200);

    let last = { status: 0, body: { error: { message: '', code: '' } } };
    for (let i = 0; i < GUEST_MINTS_PER_IP_PER_HOUR + 5; i += 1) {
      // A fresh browser each attempt: no cookie, and a user agent nobody has used before.
      // A jar-less caller that *is* already known by address and user agent is resumed
      // rather than minted, so distinct user agents are what a mint cap is about.
      last = await request(app.getHttpServer())
        .post('/api/auth/guest')
        .set('User-Agent', `jest-browser/${i}`);
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('rate_limited');
    expect(last.body.error.message).toMatch(/not a sign-in wall/i);
    expect(last.body.error.message).toMatch(/try again in a few minutes/i);
    expect(last.body.error.message).not.toMatch(/sign in to use this/i);

    const existing = await agent.post('/api/auth/guest');
    expect(existing.status).toBe(200);
    expect(existing.body.id).toBe(mine.body.id);
    const turn = await agent.post('/api/chat').send({ content: 'hello from a guest' });
    expect(turn.status).toBe(201);
  });
});
