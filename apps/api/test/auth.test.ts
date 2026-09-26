import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('auth', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-auth-'));

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

  afterAll(async () => {
    await app.close();
  });

  it('hides Google sign-in until an operator sets a client id', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body.googleClientId).toBeNull();
  });

  it('registers, sets a session cookie, and never echoes the password', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'Ada@Example.com',
      password: 'a very good passphrase',
      displayName: 'Ada',
    });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('ada@example.com'); // normalized to lowercase
    expect(res.body.displayName).toBe('Ada');
    expect(res.body.hasPassword).toBe(true);
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password_hash');
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt\$/);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith('travelclaw_session='))).toBe(true);
    expect(cookies.some((c) => /HttpOnly/i.test(c))).toBe(true);
  });

  it('rejects a duplicate email, case-insensitively, without ever storing plaintext', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'dup@example.com',
      password: 'a very good passphrase',
    });
    const again = await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'DUP@example.com',
      password: 'a different passphrase',
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('email_taken');
  });

  it('rejects a short password and a malformed email', async () => {
    const shortPw = await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'short@example.com',
      password: 'short',
    });
    expect(shortPw.status).toBe(400);
    expect(shortPw.body.error.code).toBe('validation_error');

    const badEmail = await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'not-an-email',
      password: 'a very good passphrase',
    });
    expect(badEmail.status).toBe(400);
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'login@example.com',
      password: 'correct horse battery staple',
    });

    const wrong = await request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'login@example.com',
      password: 'wrong password entirely',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('invalid_credentials');

    const right = await request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'login@example.com',
      password: 'correct horse battery staple',
    });
    expect(right.status).toBe(200);
    expect(right.body.email).toBe('login@example.com');
  });

  it('gives the same error for an unknown email as for a wrong password', async () => {
    const unknown = await request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'nobody-here@example.com',
      password: 'whatever it is',
    });
    await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'known@example.com',
      password: 'the real passphrase',
    });
    const wrongPassword = await request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'known@example.com',
      password: 'not the real passphrase',
    });
    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('rejects /me when signed out and returns the account when signed in', async () => {
    const anon = await request(app.getHttpServer()).get('/api/auth/me');
    expect(anon.status).toBe(401);

    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/register').send({
      email: 'me@example.com',
      password: 'a very good passphrase',
    });
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('me@example.com');
  });

  it('ends the session on logout so the old cookie no longer works', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/register').send({
      email: 'logout@example.com',
      password: 'a very good passphrase',
    });
    const before = await agent.get('/api/auth/me');
    expect(before.status).toBe(200);

    const out = await agent.post('/api/auth/logout').send({});
    expect(out.status).toBe(200);

    const after = await agent.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('ignores a garbage or tampered session cookie instead of crashing', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', 'travelclaw_session=not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('rate-limits repeated login failures for the same account', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({
      email: 'ratelimited@example.com',
      password: 'a very good passphrase',
    });
    let last: { status: number } = { status: 0 };
    for (let i = 0; i < 15; i += 1) {
      last = await request(app.getHttpServer()).post('/api/auth/login').send({
        email: 'ratelimited@example.com',
        password: 'nope',
      });
    }
    expect(last.status).toBe(429);
  });

  it('fails closed on a Google credential when no client id is configured', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/google').send({
      credential: 'whatever-jwt-looking-string',
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('google_not_configured');
  });

  it('validates the Google payload shape before touching the network', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/google').send({});
    expect(res.status).toBe(400);
  });
});
