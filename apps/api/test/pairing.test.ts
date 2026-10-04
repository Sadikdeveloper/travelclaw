import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Pairing auth guards every non-loopback client.
 *
 * When TRAVELCLAW_DEVICE_TOKEN is set, any caller whose IP is not loopback must present
 * the token in the X-Device-Token header (HTTP) or as a `deviceToken` handshake query
 * (WebSocket). Loopback callers (the local dev UI) never need it.
 *
 * When TRAVELCLAW_DEVICE_TOKEN is unset (the default) the gateway refuses non-loopback
 * calls entirely, rather than silently opening on 0.0.0.0 with no check.
 */
describe('pairing auth (device token for non-loopback clients)', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-pairing-'));
  const DEVICE_TOKEN = 'test-device-token-pairing-' + Math.random().toString(36).slice(2);

  async function boot(overrides: Record<string, string | undefined> = {}) {
    const suffix = Math.random().toString(36).slice(2);
    const defaults: Record<string, string | undefined> = {
      DATABASE_PATH: join(dir, `pairing-${suffix}.db`),
      WORKSPACE_PATH: join(dir, 'workspace'),
      TRAVELCLAW_NETWORK: '0',
      TRAVELCLAW_SEED: '0',
      TRAVELCLAW_HEARTBEAT: '0',
      TRAVELCLAW_MODEL_PROVIDER: 'mock',
      TRAVELCLAW_TASK_DELAY: '0',
      TRAVELCLAW_TRUST_PROXY: '1', // honor X-Forwarded-For so supertest can simulate remotes
      TRAVELCLAW_DEVICE_TOKEN: DEVICE_TOKEN,
    };
    for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0);
    return app.getHttpServer();
  }

  afterEach(async () => {
    delete process.env.TRAVELCLAW_DEVICE_TOKEN;
    delete process.env.TRAVELCLAW_TRUST_PROXY;
    if (app) await app.close();
  });

  /** Simulate a request arriving from a given remote IP (via X-Forwarded-For). */
  function asFrom(ip: string) {
    return (r: request.Test) => r.set('X-Forwarded-For', ip);
  }

  // ---- Critical edge cases ----

  it('lets a loopback caller reach health without any token', async () => {
    const server = await boot();
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
  });

  it('rejects non-loopback calls when no device token is configured (safe default)', async () => {
    // Binding 0.0.0.0 with no token set must NOT silently open the desk to the internet.
    const server = await boot({ TRAVELCLAW_DEVICE_TOKEN: undefined });
    const res = await asFrom('203.0.113.5')(request(server).get('/api/auth/config'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('pairing_required');
    expect(res.body.error.message).toMatch(/device token/i);
    expect(res.body.error.message).toMatch(/TRAVELCLAW_DEVICE_TOKEN/i);
    expect(res.body.error.token).toBeUndefined();
  });

  it('rejects a non-loopback caller that presents no token header', async () => {
    const server = await boot();
    const res = await asFrom('203.0.113.5')(request(server).get('/api/auth/config'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('pairing_required');
    expect(res.body.error.message).toMatch(/device token/i);
  });

  it('rejects a non-loopback caller whose token is wrong', async () => {
    const server = await boot();
    const res = await asFrom('203.0.113.5')(
      request(server).get('/api/auth/config').set('X-Device-Token', 'not-the-token'),
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('pairing_required');
    // The error must never echo back the wrong token the caller sent.
    expect(res.body.error.message).not.toMatch(/not-the-token/);
  });

  it('uses timing-safe comparison (a token differing only at the end is rejected)', async () => {
    const server = await boot();
    const close =
      DEVICE_TOKEN.slice(0, DEVICE_TOKEN.length - 1) +
      (DEVICE_TOKEN.endsWith('a') ? 'b' : 'a');
    const res = await asFrom('203.0.113.5')(
      request(server).get('/api/auth/config').set('X-Device-Token', close),
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('pairing_required');
  });

  it('accepts a non-loopback caller that presents the exact device token', async () => {
    const server = await boot();
    const res = await asFrom('203.0.113.5')(
      request(server).get('/api/auth/config').set('X-Device-Token', DEVICE_TOKEN),
    );
    expect(res.status).toBe(200);
  });

  it('applies to privileged routes (chat/me), not only config', async () => {
    const server = await boot();
    const chat = await asFrom('203.0.113.5')(
      request(server).post('/api/chat').send({ content: 'hi' }),
    );
    expect(chat.status).toBe(401);
    expect(chat.body.error.code).toBe('pairing_required');
  });

  it('recognises every common loopback form', async () => {
    const server = await boot();
    // IPv4 loopback
    expect(
      (await asFrom('127.0.0.1')(request(server).get('/api/auth/config'))).status,
    ).toBe(200);
    // The whole 127.0.0.0/8 block is loopback
    expect(
      (await asFrom('127.255.255.1')(request(server).get('/api/auth/config'))).status,
    ).toBe(200);
    // IPv6 loopback
    expect((await asFrom('::1')(request(server).get('/api/auth/config'))).status).toBe(200);
  });

  it('does not confuse private LAN addresses for loopback', async () => {
    const server = await boot();
    for (const ip of ['192.168.1.5', '10.0.0.5', '172.16.0.5', '169.254.1.1']) {
      const res = await asFrom(ip)(request(server).get('/api/auth/config'));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('pairing_required');
    }
  });

  it('never leaks the configured token in any error body', async () => {
    const server = await boot();
    const res = await asFrom('203.0.113.5')(
      request(server).get('/api/auth/config').set('X-Device-Token', 'wrong'),
    );
    expect(JSON.stringify(res.body)).not.toContain(DEVICE_TOKEN);
  });

  it('allows /health from any address without a token (container/lb liveness)', async () => {
    const server = await boot();
    const res = await asFrom('203.0.113.5')(request(server).get('/health'));
    expect(res.status).toBe(200);
  });

  it('rejects an empty device token header as unpaired', async () => {
    const server = await boot();
    const res = await asFrom('203.0.113.5')(
      request(server).get('/api/auth/config').set('X-Device-Token', ''),
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('pairing_required');
  });

  it('rejects a WebSocket that presents an empty deviceToken query', async () => {
    const server = await boot();
    const port = (server.address() as { port: number }).port;
    const socket: ClientSocket = ioc(`http://127.0.0.1:${port}?deviceToken=`, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      extraHeaders: { 'X-Forwarded-For': '203.0.113.5' },
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 3000);
      socket.on('connect_error', () => {
        clearTimeout(t);
        resolve();
      });
      socket.on('connect', () => {
        clearTimeout(t);
        socket.disconnect();
        reject(new Error('empty token accepted'));
      });
    });
  });

  it('prefers the leftmost X-Forwarded-For entry when a chain is present', async () => {
    const server = await boot();
    // Leftmost is the real client; proxy chain appended to the right.
    const res = await request(server)
      .get('/api/auth/config')
      .set('X-Forwarded-For', '203.0.113.5, 10.0.0.1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('pairing_required');

    // Loopback leftmost, anything to the right is irrelevant.
    const ok = await request(server)
      .get('/api/auth/config')
      .set('X-Forwarded-For', '127.0.0.1, 10.0.0.1');
    expect(ok.status).toBe(200);
  });

  // ---- WebSocket pairing (critical for live UI and future channel bots) ----

  it('accepts a WebSocket from a non-loopback caller with a valid deviceToken query', async () => {
    const server = await boot();
    const port = (server.address() as { port: number }).port;
    const socket: ClientSocket = ioc(`http://127.0.0.1:${port}`, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      extraHeaders: { 'X-Forwarded-For': '203.0.113.5' },
      query: { deviceToken: DEVICE_TOKEN },
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for connect')), 3000);
      socket.on('connect', () => {
        clearTimeout(t);
        socket.disconnect();
        resolve();
      });
      socket.on('connect_error', (err: { message: string }) => {
        clearTimeout(t);
        reject(new Error('paired socket failed to connect: ' + err.message));
      });
    });
  });

  it('refuses a WebSocket from a non-loopback caller without a device token', async () => {
    const server = await boot();
    const port = (server.address() as { port: number }).port;
    const socket: ClientSocket = ioc(`http://127.0.0.1:${port}`, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      extraHeaders: { 'X-Forwarded-For': '203.0.113.5' },
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('timeout waiting for connect_error')),
        3000,
      );
      socket.on('connect_error', (err: { message: string }) => {
        clearTimeout(t);
        expect(err.message).toMatch(/device token/i);
        resolve();
      });
      socket.on('connect', () => {
        clearTimeout(t);
        socket.disconnect();
        reject(new Error('non-loopback socket connected without a device token'));
      });
    });
  });
});
