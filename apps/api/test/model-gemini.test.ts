import type { ModelRecord } from '@travelclaw/shared';
import { ModelService } from '../src/models/model.service';

const flash: ModelRecord = {
  id: 'gemini-2.5-flash',
  label: 'Gemini 2.5 Flash',
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
    expect(calledBody?.model).toBe('gemini-2.5-flash');
    expect(completion).toMatchObject({
      text: 'Hello from Flash.',
      provider: 'google',
      model: 'gemini-2.5-flash',
    });
  });
});
