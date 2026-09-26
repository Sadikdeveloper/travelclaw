import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

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

  afterAll(async () => {
    await app.close();
  });

  it('mints a guest with no signup and lets it use chat right away', async () => {
    const agent = request.agent(app.getHttpServer());
    const guest = await agent.post('/api/auth/guest');
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

  it('rate-limits chat turns from a guest tighter than a signed-up account', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/guest');
    const session = await agent.post('/api/sessions').send({ channel: 'webchat' });

    let last = { status: 0 };
    for (let i = 0; i < 20; i += 1) {
      last = await agent
        .post(`/api/sessions/${session.body.id}/messages`)
        .send({ content: `turn ${i}` });
    }
    expect(last.status).toBe(429);
  });
});
