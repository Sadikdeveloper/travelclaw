import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

interface ModelRequest {
  url: string;
  body: {
    messages: Array<{ role: string; content: string }>;
    tools?: Array<{
      function: { name: string; parameters: { properties: Record<string, unknown> } };
    }>;
    tool_choice?: string;
  };
}

/**
 * The whole path with a live provider: the gateway offers the catalog, the model
 * asks for a tool, the tool runs, and the narration pass is grounded in it.
 * `fetch` is stubbed, so nothing leaves the process.
 */
describe('chat with a tool-calling model', () => {
  let app: INestApplication;
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-model-'));
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const requests: ModelRequest[] = [];
  const replies: unknown[] = [];

  beforeAll(async () => {
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'openai';
    process.env.TRAVELCLAW_MODEL_API_KEY = 'test-key';
    process.env.TRAVELCLAW_MODEL_NAME = 'gpt-test';
    process.env.TRAVELCLAW_MODEL_BASE_URL = 'https://model.test/v1';

    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const reply = replies.shift() ?? {
        choices: [{ message: { content: 'No script left.' } }],
      };
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    await app.close();
  });

  beforeEach(() => {
    requests.length = 0;
    replies.length = 0;
  });

  async function signedInAgent() {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/register').send({
      email: `model-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'correct horse battery staple',
      displayName: 'Model Traveler',
    });
    expect(res.status).toBe(201);
    return agent;
  }

  it('runs the tool the model asks for and narrates the result', async () => {
    replies.push(
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'trip.outline',
                    arguments: JSON.stringify({
                      destination: 'Lisbon',
                      startDate: '2026-10-12',
                      days: 4,
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [{ message: { content: 'Four days in Lisbon, arrival day kept light.' } }],
      },
    );
    const agent = await signedInAgent();

    const res = await agent
      .post('/api/chat')
      .send({ content: 'Plan Lisbon from 2026-10-12' });

    expect(res.status).toBe(201);
    expect(res.body.message.content).toBe('Four days in Lisbon, arrival day kept light.');
    expect(res.body.tools).toEqual([
      {
        name: 'trip.outline',
        ok: true,
        summary: expect.stringMatching(/4-day outline for Lisbon/),
        source: 'model',
      },
    ]);

    // The first request carried the catalog; the narration pass did not.
    expect(requests[0].url).toBe('https://model.test/v1/chat/completions');
    expect(requests[0].body.tools).toHaveLength(8);
    expect(
      Object.keys(requests[0].body.tools?.[0].function.parameters.properties ?? {}),
    ).toContain('destination');
    expect(requests[0].body.tool_choice).toBe('auto');
    expect(requests[1].body.tools).toBeUndefined();
    expect(requests[1].body.messages[0].content).toMatch(/2026-10-15/);

    // The trace is stored with the assistant message.
    const stored = await agent.get(`/api/sessions/${res.body.session.id}`);
    expect(stored.status).toBe(200);
    const assistant = stored.body.messages.filter(
      (message: { role: string }) => message.role === 'assistant',
    );
    expect(assistant.at(-1).tools[0].source).toBe('model');
  });

  it('reports a rejected call and still answers', async () => {
    replies.push(
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'currency.convert',
                    arguments: '{"amount":"lots","fromCurrency":"USD","toCurrency":"EUR"}',
                  },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: 'How much should I convert?' } }] },
    );
    const agent = await signedInAgent();

    const res = await agent.post('/api/chat').send({ content: 'Money question' });

    expect(res.status).toBe(201);
    expect(res.body.message.content).toBe('How much should I convert?');
    expect(res.body.tools).toEqual([
      {
        name: 'currency.convert',
        ok: false,
        summary: expect.stringMatching(/could not read that currency conversion/i),
        source: 'model',
      },
    ]);
    // The narration pass is told the tool needs input, never the schema wording.
    expect(JSON.stringify(requests[1].body)).not.toMatch(/Expected|zod/i);
  });

  it('falls back to the router when the model asks for nothing', async () => {
    replies.push(
      { choices: [{ message: { content: 'Thinking.' } }] },
      {
        choices: [
          { message: { content: 'Reykjavik in four days wants a windproof shell.' } },
        ],
      },
    );
    const agent = await signedInAgent();

    const res = await agent.post('/api/chat').send({
      content: 'What should I pack for Reykjavik for 4 days?',
    });

    expect(res.status).toBe(201);
    expect(res.body.tools).toEqual([
      {
        name: 'packing.list',
        ok: true,
        summary: expect.stringMatching(/packing notes/),
        source: 'router',
      },
    ]);
    expect(res.body.message.content).toBe(
      'Reykjavik in four days wants a windproof shell.',
    );
  });

  it('shows the desk rendering when the model call fails', async () => {
    global.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const agent = await signedInAgent();

    const res = await agent.post('/api/chat').send({
      content: 'What should I pack for Reykjavik for 4 days?',
    });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe('mock');
    expect(res.body.message.content).toMatch(/windproof/i);
    expect(res.body.tools[0].source).toBe('router');
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const reply = replies.shift() ?? {
        choices: [{ message: { content: 'No script left.' } }],
      };
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  });
});
