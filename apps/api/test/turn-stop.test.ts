import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Stop on a live turn: the traveler closes the stream mid-answer, and the turn
 * is cancelled rather than rescued. Nothing half-written is saved, and the desk
 * rendering is not quietly substituted for the answer the model was writing.
 */
describe('stopping a streamed turn', () => {
  let app: INestApplication;
  let server: Server;
  let base: string;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-stop-'));
  const originalFetch = global.fetch;
  // The test's own HTTP calls must bypass the model stub below.
  const clientFetch = (...args: Parameters<typeof fetch>) => originalFetch(...args);
  const originalEnv = { ...process.env };
  let sawAbort = false;

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'openai';
    process.env.TRAVELCLAW_MODEL_API_KEY = 'test-key';
    process.env.TRAVELCLAW_MODEL_NAME = 'gpt-stream-test';
    process.env.TRAVELCLAW_MODEL_BASE_URL = 'https://model.test/v1';

    global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      const encoder = new TextEncoder();
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (signal?.aborted) {
            sawAbort = true;
            controller.error(new DOMException('This operation was aborted', 'AbortError'));
            return;
          }
          if (sent === 0) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: { reasoning_content: 'Thinking about Lisbon. ' } }],
                })}\n\n`,
              ),
            );
            sent += 1;
            return;
          }
          if (sent < 6) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: { content: `word${sent} ` } }],
                })}\n\n`,
              ),
            );
            sent += 1;
            await new Promise((resolve) => setTimeout(resolve, 25));
            return;
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    await new Promise<void>((resolve) => {
      if (server.listening) return resolve();
      server.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    await app.close();
  });

  it('cancels the model call and saves nothing when the client goes away', async () => {
    const registered = await clientFetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `stop-${Math.random().toString(36).slice(2)}@example.com`,
        password: 'correct horse battery staple',
        displayName: 'Stopping Traveler',
      }),
    });
    const cookie = (registered.headers.getSetCookie?.() ?? [])
      .map((value) => value.split(';')[0])
      .join('; ');

    const opened = await clientFetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ channel: 'webchat' }),
    });
    const sessionId = ((await opened.json()) as { id: string }).id;

    const controller = new AbortController();
    const response = await clientFetch(
      `${base}/api/sessions/${sessionId}/messages/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie,
          accept: 'text/event-stream',
        },
        body: JSON.stringify({ content: 'Plan me four days in Lisbon in November.' }),
        signal: controller.signal,
      },
    );
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let seen = '';
    // Stop only once the answer is actually being written, so this covers a
    // turn interrupted mid-stream rather than one that never started.
    while (!seen.includes('"reply.delta"')) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
    }
    expect(seen).toContain('"reply.delta"');
    controller.abort();
    await reader.cancel().catch(() => {});

    // Give the gateway time to observe the close and unwind the turn.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const after = await clientFetch(`${base}/api/sessions/${sessionId}`, {
      headers: { cookie },
    });
    const session = (await after.json()) as { messages: Array<{ role: string }> };
    expect(session.messages.map((message) => message.role)).toEqual(['user']);
    expect(sawAbort).toBe(true);
  });
});
