import { Logger } from '@nestjs/common';
import type { ModelRecord } from '@travelclaw/shared';
import { loadConfig } from '../src/config';
import {
  DESK_MODEL_ID,
  modelCatalog,
  providerForModelId,
  resolveProvider,
} from '../src/models/model-catalog';
import { ModelService } from '../src/models/model.service';

const opus5: ModelRecord = {
  id: 'claude-opus-5',
  label: 'Claude Opus 5',
  provider: 'codecraft',
  tier: 'strong',
  limits: { guest: 2, account: 15 },
  offline: false,
  available: true,
};

describe('CodeCraft and other OpenAI-compatible aggregators', () => {
  it('turns a bare CodeCraft key into a working configuration', () => {
    const config = loadConfig({
      TRAVELCLAW_MODEL_PROVIDER: 'codecraft',
      CODECRAFT_API_KEY: 'cc_test_key',
      TRAVELCLAW_CODECRAFT_BASE_URL: 'https://codecraftapi.com/v1/',
    });

    // Balanced current Claude, not the priciest id: the operator raises or lowers it in
    // TRAVELCLAW_MODELS, exactly like the Gemini default.
    expect(config.modelName).toBe('claude-sonnet-5');
    expect(config.codecraftApiKey).toBe('cc_test_key');
    expect(config.codecraftBaseUrl).toBe('https://codecraftapi.com/v1');
  });

  it('names the aggregator families TravelClaw has no connector of its own for', () => {
    expect(providerForModelId('claude-opus-5')).toBe('codecraft');
    expect(providerForModelId('claude-sonnet-4')).toBe('codecraft');
    expect(providerForModelId('qwen3.8-max')).toBe('codecraft');
    expect(providerForModelId('glm-5.3')).toBe('codecraft');
    // A family with its own connector keeps it — an aggregator never silently takes over
    // a model this deployment has a native key for.
    expect(providerForModelId('kimi-k3')).toBe('kimi');
    expect(providerForModelId('gemini-3.8-flash')).toBe('google');
  });

  it('routes a family without its own key through the aggregator, and nothing else', () => {
    const aggregator = loadConfig({
      TRAVELCLAW_MODEL_PROVIDER: 'codecraft',
      TRAVELCLAW_CODECRAFT_API_KEY: 'cc_test_key',
    });
    // CodeCraft serves the Gemini family too, so an id whose own key is absent runs there.
    expect(resolveProvider(aggregator, 'gemini-3.7-flash')).toBe('codecraft');
    expect(resolveProvider(aggregator, 'claude-opus-5')).toBe('codecraft');
    expect(resolveProvider(aggregator, 'brand-new-aggregator-id')).toBe('codecraft');
    expect(resolveProvider(aggregator, DESK_MODEL_ID)).toBe('mock');

    // A native key wins for its own family.
    const both = loadConfig({
      TRAVELCLAW_MODEL_PROVIDER: 'codecraft',
      TRAVELCLAW_CODECRAFT_API_KEY: 'cc_test_key',
      TRAVELCLAW_GOOGLE_API_KEY: 'g-key-test',
    });
    expect(resolveProvider(both, 'gemini-3.8-flash')).toBe('google');
    expect(resolveProvider(both, 'claude-opus-5')).toBe('codecraft');
  });

  it('offers the strongest configured aggregator model, with a pace on it', () => {
    const config = loadConfig({
      TRAVELCLAW_MODEL_PROVIDER: 'codecraft',
      TRAVELCLAW_CODECRAFT_API_KEY: 'cc_test_key',
      TRAVELCLAW_MODEL_NAME: 'claude-sonnet-5',
      TRAVELCLAW_MODELS: 'claude-sonnet-5,claude-opus-5',
    });
    const catalog = modelCatalog(config);
    const opus = catalog.models.find((model) => model.id === 'claude-opus-5');
    const sonnet = catalog.models.find((model) => model.id === 'claude-sonnet-5');

    expect(catalog.current).toBe('claude-opus-5');
    expect(opus?.label).toBe('Claude Opus 5');
    expect(opus?.provider).toBe('codecraft');
    expect(opus?.available).toBe(true);
    // A pricier model is rationed tighter than a cheaper one.
    expect(opus!.limits!.guest).toBeLessThan(sonnet!.limits!.guest);
    expect(opus!.limits!.account).toBeGreaterThan(opus!.limits!.guest);

    // Without a key the models stay visible as what a key would unlock.
    const keyless = loadConfig({
      TRAVELCLAW_MODEL_PROVIDER: 'codecraft',
      TRAVELCLAW_MODEL_NAME: 'claude-opus-5',
    });
    expect(keyless.codecraftApiKey).toBeNull();
    expect(
      modelCatalog(keyless).models.find((m) => m.id === 'claude-opus-5')?.available,
    ).toBe(false);
    expect(modelCatalog(keyless).current).toBe(DESK_MODEL_ID);
  });
});

describe('the CodeCraft wire', () => {
  const environment = { ...process.env };
  const realFetch = global.fetch;

  afterEach(() => {
    process.env = { ...environment };
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('posts to the aggregator’s chat completions endpoint with its own key', async () => {
    Object.assign(process.env, {
      TRAVELCLAW_MODEL_PROVIDER: 'codecraft',
      TRAVELCLAW_CODECRAFT_API_KEY: 'cc_test_key',
      TRAVELCLAW_MODEL_NAME: 'claude-opus-5',
      TRAVELCLAW_MODEL_BASE_URL: '',
      TRAVELCLAW_MODEL_API_KEY: '',
    });
    let calledUrl = '';
    let calledAuth = '';
    let calledBody: Record<string, unknown> | undefined;
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url);
      calledAuth = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization,
      );
      calledBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Lisbon in April is mild.',
                // Reasoning stays out of the answer the traveler sees.
                reasoning_content: 'Consider the shoulder season…',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ModelService().providerFor(opus5);
    const completion = await provider.complete({
      system: 'Be concise.',
      history: [],
      user: 'When should I go to Lisbon?',
      fallback: 'Desk fallback.',
    });

    expect(calledUrl).toBe('https://codecraftapi.com/v1/chat/completions');
    expect(calledAuth).toBe('Bearer cc_test_key');
    expect(calledBody?.model).toBe('claude-opus-5');
    expect(completion).toMatchObject({
      text: 'Lisbon in April is mild.',
      provider: 'codecraft',
      model: 'claude-opus-5',
    });
  });

  it('reads a tool call the model asks for, then falls back honestly on a 404', async () => {
    Object.assign(process.env, {
      TRAVELCLAW_MODEL_PROVIDER: 'codecraft',
      TRAVELCLAW_CODECRAFT_API_KEY: 'cc_test_key',
      TRAVELCLAW_MODEL_NAME: 'claude-opus-5',
    });
    let call = 0;
    global.fetch = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_abc123',
                      type: 'function',
                      function: {
                        name: 'trip.outline',
                        arguments: '{"destination":"Lisbon"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ error: { message: 'Not found', type: 'invalid_request_error' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const warnings: string[] = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => void warnings.push(String(message)));

    const provider = new ModelService().providerFor(opus5);
    const withTools = await provider.complete({
      system: 'System.',
      history: [],
      user: 'Plan Lisbon',
      fallback: 'Desk fallback.',
      tools: [
        {
          name: 'trip.outline',
          description: 'Outline a trip.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    });
    expect(withTools.toolCalls?.[0]).toMatchObject({
      id: 'call_abc123',
      name: 'trip.outline',
      arguments: '{"destination":"Lisbon"}',
    });

    // A 404 outlives the model: the reply is the desk rendering, never an invented answer,
    // and the log says which provider and model failed.
    const failed = await provider.complete({
      system: 'System.',
      history: [],
      user: 'Plan Lisbon',
      fallback: 'Desk fallback.',
    });
    expect(failed).toMatchObject({ text: 'Desk fallback.', provider: 'mock' });
    expect(warnings.join('\n')).toContain('codecraft/claude-opus-5 HTTP 404');
  });
});
