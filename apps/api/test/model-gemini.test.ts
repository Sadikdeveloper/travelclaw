import { Logger } from '@nestjs/common';
import type { ModelRecord } from '@travelclaw/shared';
import { ModelService } from '../src/models/model.service';

const flash: ModelRecord = {
  id: 'gemini-3.8-flash',
  label: 'Gemini 3.8 Flash',
  provider: 'google',
  tier: 'fast',
  limits: { guest: 5, account: 30 },
  offline: false,
  available: true,
};

describe('Gemini model provider', () => {
  const environment = { ...process.env };
  const realFetch = global.fetch;

  afterEach(() => {
    process.env = { ...environment };
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('uses Gemini’s OpenAI-compatible chat endpoint and canonical Flash model', async () => {
    Object.assign(process.env, {
      TRAVELCLAW_MODEL_PROVIDER: 'google',
      GEMINI_API_KEY: 'test-only-gemini-key',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
      TRAVELCLAW_MODEL_NAME: 'gemini-flash',
    });
    let calledUrl = '';
    let calledBody: Record<string, unknown> | undefined;
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url);
      calledBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Hello from Flash.' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ModelService().providerFor(flash);
    const completion = await provider.complete({
      system: 'Be concise.',
      history: [],
      user: 'Hello',
      fallback: 'Desk fallback.',
    });

    expect(calledUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    expect(calledBody?.model).toBe('gemini-3.8-flash');
    expect(completion).toMatchObject({
      text: 'Hello from Flash.',
      provider: 'google',
      model: 'gemini-3.8-flash',
    });
  });

  it('names what the key can run when a 404 outlives the model', async () => {
    // The same failure a key created after the Gemini 3 rollout sees on a 2.5 id:
    // chat completions 404s, and the error body is never logged. The model list is.
    Object.assign(process.env, {
      TRAVELCLAW_MODEL_PROVIDER: 'google',
      GEMINI_API_KEY: 'test-only-gemini-key',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
      TRAVELCLAW_MODEL_NAME: 'gemini-2.5-pro',
    });
    const warnings: string[] = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => void warnings.push(String(message)));

    const calledUrls: string[] = [];
    global.fetch = (async (url: string | URL | Request) => {
      calledUrls.push(String(url));
      if (String(url).endsWith('/models')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'gemini-3.8-flash' },
              { id: 'gemini-3.1-pro-preview' },
              { id: 'gemini-3.1-flash-image' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
    }) as typeof fetch;

    const service = new ModelService();
    const provider = service.providerFor(service.best());
    const completion = await provider.complete({
      system: 'Be concise.',
      history: [],
      user: 'Hello',
      fallback: 'Desk fallback.',
    });

    expect(completion).toMatchObject({ text: 'Desk fallback.', provider: 'mock' });
    expect(calledUrls).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
    ]);
    const log = warnings.join('\n');
    expect(log).toContain('Model google/gemini-2.5-pro HTTP 404');
    expect(log).toContain('legacy Gemini id');
    expect(log).toContain(
      'google lists these models for this key: gemini-3.1-pro-preview, gemini-3.8-flash',
    );
  });

  it('probes the model list once, not once per failed turn', async () => {
    Object.assign(process.env, {
      TRAVELCLAW_MODEL_PROVIDER: 'google',
      GEMINI_API_KEY: 'test-only-gemini-key',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
      TRAVELCLAW_MODEL_NAME: 'gemini-2.5-pro',
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    let probes = 0;
    global.fetch = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/models')) {
        probes += 1;
        return new Response(JSON.stringify({ data: [{ id: 'gemini-3.8-flash' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const service = new ModelService();
    const provider = service.providerFor(service.best());
    const turn = {
      system: 'Be concise.',
      history: [],
      user: 'Hello',
      fallback: 'Desk fallback.',
    };
    await provider.complete(turn);
    await provider.complete(turn);

    expect(probes).toBe(1);
  });
});
