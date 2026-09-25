import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('gateway', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-'));

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'mock';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('travelclaw-gateway');
    expect(res.body.workspace).toBe('ok');
    expect(res.body.model.provider).toBe('mock');
  });

  it('plans a Lisbon trip without claiming a booking', async () => {
    const created = await request(app.getHttpServer()).post('/api/trips').send({
      destination: 'Lisbon',
      startDate: '2026-10-12',
      endDate: '2026-10-15',
      travelers: 2,
      pace: 'steady',
    });
    expect(created.status).toBe(201);
    const planned = await request(app.getHttpServer())
      .post(`/api/trips/${created.body.id}/plan`)
      .send({});
    expect(planned.status).toBe(201);
    expect(planned.body.days).toHaveLength(4);
    expect(planned.body.days[0].title).toMatch(/Arrival/);
    expect(planned.body.status).toBe('planning');
  });

  it('answers a packing question from tools', async () => {
    const res = await request(app.getHttpServer()).post('/api/chat').send({
      content: 'What should I pack for Reykjavik for 4 days?',
    });
    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('mock');
    expect(res.body.message.content).toMatch(/windproof/i);
    expect(res.body.message.content).toMatch(/have not booked/i);
  });

  it('stores a remembered preference', async () => {
    const res = await request(app.getHttpServer()).post('/api/chat').send({
      content: '/remember I prefer trains to taxis',
    });
    expect(res.status).toBe(201);
    const memory = await request(app.getHttpServer()).get('/api/memory');
    expect(memory.status).toBe(200);
    expect(
      memory.body.some((note: { body: string }) => /trains to taxis/i.test(note.body)),
    ).toBe(true);
  });

  it('spins flight and stay desks, then accepts a decision', async () => {
    const res = await request(app.getHttpServer()).post('/api/chat').send({
      content: 'Book a flight and a hotel in Lisbon from Lagos on 2026-11-02',
    });
    expect(res.status).toBe(201);
    expect(res.body.message.content).toMatch(/Nothing is booked/);
    const tasks = await request(app.getHttpServer()).get(
      `/api/sessions/${res.body.session.id}/tasks`,
    );
    expect(tasks.status).toBe(200);
    expect(tasks.body).toHaveLength(2);
    expect(tasks.body.map((task: { agentName: string }) => task.agentName).sort()).toEqual([
      'Flight desk',
      'Stay desk',
    ]);
    expect(tasks.body.every((task: { status: string }) => task.status === 'awaiting')).toBe(
      true,
    );
    expect(JSON.stringify(tasks.body)).toMatch(/Nothing was purchased/);
    expect(JSON.stringify(tasks.body)).not.toMatch(/ticket is booked|room is booked/i);

    const decision = await request(app.getHttpServer())
      .post(`/api/tasks/${tasks.body[0].id}/decision`)
      .send({ decision: 'complete' });
    expect(decision.status).toBe(201);
    expect(decision.body.status).toBe('accepted');
    expect(decision.body.summary).toMatch(/Nothing was purchased/);
  });

  it('rejects an inverted date range', async () => {
    const res = await request(app.getHttpServer()).post('/api/trips').send({
      destination: 'Rome',
      startDate: '2026-06-10',
      endDate: '2026-06-01',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});
