import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * The live turn, end to end: one POST that streams its own progress back. The
 * desk model runs offline here, so what is asserted is the shape and the order —
 * a start, the steps, the reply arriving as a delta, and the persisted record at
 * the end. A rejected caller gets ordinary JSON, never an empty event stream.
 */
describe('streaming a turn', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-stream-'));
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_TASK_DELAY = '0';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    process.env = originalEnv;
    await app.close();
  });

  function parseStream(body: string): Array<Record<string, unknown>> {
    return body
      .split('\n\n')
      .map((frame) => frame.split('\n').find((line) => line.startsWith('data:')))
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
  }

  it('streams the steps and the reply, then the saved message', async () => {
    const agent = request.agent(app.getHttpServer());
    const registered = await agent.post('/api/auth/register').send({
      email: `stream-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'correct horse battery staple',
      displayName: 'Stream Traveler',
    });
    expect(registered.status).toBe(201);
    const opened = await agent.post('/api/sessions').send({ channel: 'webchat' });
    expect(opened.status).toBe(201);
    const sessionId = opened.body.id as string;

    const response = await agent
      .post(`/api/sessions/${sessionId}/messages/stream`)
      .set('Accept', 'text/event-stream')
      // Superagent only buffers bodies whose mime type it knows; an event
      // stream is collected as text so the whole turn can be asserted.
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => callback(null, data));
      })
      .send({ content: 'Plan Lisbon from 2026-11-02 to 2026-11-06' });

    // 200, not the 201 a plain POST would answer: the stream carries the record
    // at the end instead of a created-resource status at the start.
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    // The custom parser hands the collected text back as `body`.
    const events = parseStream(
      typeof response.body === 'string' ? response.body : String(response.text ?? ''),
    );
    const types = events.map((event) => event.type);

    expect(types[0]).toBe('turn.started');
    expect(types.at(-1)).toBe('turn.completed');
    expect(types).toContain('step');
    expect(types).toContain('reply.delta');

    const steps = events
      .filter((event) => event.type === 'step')
      .map(
        (event) => event.step as { id: string; kind: string; state: string; name?: string },
      );
    expect(steps[0]).toMatchObject({ kind: 'stage', state: 'done' });
    const toolSteps = steps.filter((step) => step.kind === 'tool');
    // One step, announced running and then finished — one id, so the screen
    // updates the row instead of appending a second one.
    expect(toolSteps.map((step) => step.name)).toEqual(['trip.outline', 'trip.outline']);
    expect(toolSteps[0].id).toBe(toolSteps[1].id);
    expect(toolSteps.map((step) => step.state)).toEqual(['running', 'done']);

    const completed = events.at(-1) as {
      response: { message: { content: string; tools: Array<{ name: string }> } };
    };
    expect(completed.response.message.content).toMatch(/Outline for Lisbon/);
    expect(completed.response.message.tools[0].name).toBe('trip.outline');

    // The reply that streamed is the reply that was saved.
    const streamed = events
      .filter((event) => event.type === 'reply.delta')
      .map((event) => event.text as string)
      .join('');
    expect(streamed).toBe(completed.response.message.content);

    const reopened = await agent.get(`/api/sessions/${sessionId}`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.messages.at(-1).content).toBe(completed.response.message.content);
  });

  it('refuses a signed-out caller with JSON, not an empty stream', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/sessions/whatever/messages/stream')
      .set('Accept', 'text/event-stream')
      .send({ content: 'Plan Lisbon from 2026-11-02 to 2026-11-06' });

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});
