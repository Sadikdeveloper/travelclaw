import {
  DESK_MODEL_ID,
  bestModelId,
  limitsFor,
  modelCatalog,
} from '../src/models/model-catalog';
import type { AppConfig } from '../src/config';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '0.0.0.0',
    port: 3000,
    databasePath: ':memory:',
    workspacePath: '/tmp',
    modelProvider: 'mock',
    modelBaseUrl: 'http://127.0.0.1:9/v1',
    modelApiKey: '',
    modelName: DESK_MODEL_ID,
    modelNames: [],
    network: false,
    browserWorkerUrl: null,
    browserWorkerToken: null,
    seed: false,
    taskDelayMs: 0,
    version: 'test',
    googleClientId: null,
    cookieSecure: false,
    cookieName: 'travelclaw_session',
    allowedOrigins: [],
    sessionTtlDays: 30,
    currencyBaseUrl: null,
    currencyApiKey: null,
    weatherBaseUrl: null,
    weatherApiKey: null,
    flightProviders: null,
    stayProviders: null,
    searchBookerCountry: null,
    searchCurrency: null,
    searchLanguage: null,
    flightBaseUrl: null,
    flightApiKey: null,
    stayBaseUrl: null,
    stayApiKey: null,
    deviceTokenHash: null,
    trustProxy: false,
    trustedProxies: [],
    googleApiKey: null,
    googleBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    xaiApiKey: null,
    xaiBaseUrl: 'https://api.x.ai/v1',
    deepseekApiKey: null,
    deepseekBaseUrl: 'https://api.deepseek.com/v1',
    kimiApiKey: null,
    kimiBaseUrl: 'https://api.moonshot.ai/v1',
    ...overrides,
  };
}

const live = { modelProvider: 'openai' as const, modelApiKey: 'sk-test' };

describe('model catalog', () => {
  it('falls back to the offline desk model when nothing else can run', () => {
    const catalog = modelCatalog(
      config({ modelName: 'gpt-4o-mini', modelNames: ['gpt-4o'] }),
    );
    const byId = Object.fromEntries(catalog.models.map((model) => [model.id, model]));
    expect(byId[DESK_MODEL_ID].available).toBe(true);
    expect(byId[DESK_MODEL_ID].offline).toBe(true);
    // A configured live model with no key is still listed — so the UI can show what a key
    // would unlock — but it cannot be selected, and nothing silently runs on it.
    expect(byId['gpt-4o'].available).toBe(false);
    expect(catalog.current).toBe(DESK_MODEL_ID);
  });

  it('picks the strongest configured model, not the first one listed', () => {
    // The operator named the small model first and listed the big one second.
    expect(
      bestModelId(
        config({
          ...live,
          modelName: 'gpt-4o-mini',
          modelNames: ['gpt-4o-mini', 'gpt-4o'],
        }),
      ),
    ).toBe('gpt-4o');
    expect(
      bestModelId(
        config({
          ...live,
          modelName: 'gpt-4o-mini',
          modelNames: ['gpt-4o-mini', 'o4-mini'],
        }),
      ),
    ).toBe('o4-mini');
    // Only what is actually configured is a candidate, however good the alternative is.
    expect(bestModelId(config({ ...live, modelName: 'gpt-4o-mini', modelNames: [] }))).toBe(
      'gpt-4o-mini',
    );
  });

  it('uses an unknown configured model before falling back to the offline one', () => {
    const named = config({ ...live, modelName: 'brand-new-model-2027', modelNames: [] });
    expect(bestModelId(named)).toBe('brand-new-model-2027');
    // But a model the desk does know the size of outranks one it cannot describe.
    const both = config({
      ...live,
      modelName: 'brand-new-model-2027',
      modelNames: ['gpt-4o-mini'],
    });
    expect(bestModelId(both)).toBe('gpt-4o-mini');
    expect(
      modelCatalog(both).models.find((m) => m.id === 'brand-new-model-2027')?.label,
    ).toBe('brand-new-model-2027');
  });

  it('leaves the desk’s own model unpaced — the limit belongs to a model, not the desk', () => {
    expect(limitsFor(DESK_MODEL_ID)).toBeNull();
    const catalog = modelCatalog(
      config({ ...live, modelName: 'gpt-4o-mini', modelNames: ['gpt-4o'] }),
    );
    expect(catalog.models.find((model) => model.id === DESK_MODEL_ID)?.limits).toBeNull();
  });

  it('paces a bigger model tighter than a small one, and an account far above a guest', () => {
    const mini = limitsFor('gpt-4o-mini')!;
    const big = limitsFor('gpt-4o')!;
    expect(mini.guest).toBeGreaterThan(big.guest);
    expect(mini.account).toBeGreaterThan(mini.guest);
    expect(big.account).toBeGreaterThan(big.guest);
    // A priced model the catalog has never heard of is paced conservatively, not left open.
    expect(limitsFor('some-new-model-2027')!.guest).toBeLessThanOrEqual(mini.guest);
  });

  it('supports Google Gemini and xAI Grok models with provider-specific API keys', () => {
    const googleCfg = config({
      modelName: 'gemini-2.5-pro',
      modelNames: ['gemini-2.5-flash'],
      googleApiKey: 'g-key-test',
      modelApiKey: '',
    });
    const googleCat = modelCatalog(googleCfg);
    expect(googleCat.current).toBe('gemini-2.5-pro');
    expect(googleCat.models.find((m) => m.id === 'gemini-2.5-pro')?.available).toBe(true);
    expect(googleCat.models.find((m) => m.id === 'gemini-2.5-pro')?.provider).toBe('google');

    const xaiCfg = config({
      modelName: 'grok-2',
      modelNames: ['grok-beta'],
      xaiApiKey: 'xai-key-test',
      modelApiKey: '',
    });
    const xaiCat = modelCatalog(xaiCfg);
    expect(xaiCat.current).toBe('grok-2');
    expect(xaiCat.models.find((m) => m.id === 'grok-2')?.available).toBe(true);
    expect(xaiCat.models.find((m) => m.id === 'grok-2')?.provider).toBe('xai');
  });

  it('supports DeepSeek and Moonshot Kimi models with provider-specific API keys', () => {
    const deepseekCfg = config({
      modelName: 'deepseek-reasoner',
      modelNames: ['deepseek-chat'],
      deepseekApiKey: 'ds-key-test',
      modelApiKey: '',
    });
    const dsCat = modelCatalog(deepseekCfg);
    expect(dsCat.current).toBe('deepseek-reasoner');
    expect(dsCat.models.find((m) => m.id === 'deepseek-reasoner')?.available).toBe(true);
    expect(dsCat.models.find((m) => m.id === 'deepseek-reasoner')?.provider).toBe('deepseek');

    const kimiCfg = config({
      modelName: 'kimi-k3',
      modelNames: ['moonshot-v1-32k'],
      kimiApiKey: 'kimi-key-test',
      modelApiKey: '',
    });
    const kimiCat = modelCatalog(kimiCfg);
    expect(kimiCat.current).toBe('kimi-k3');
    expect(kimiCat.models.find((m) => m.id === 'kimi-k3')?.available).toBe(true);
    expect(kimiCat.models.find((m) => m.id === 'kimi-k3')?.provider).toBe('kimi');
  });

  it('supports tier preference routing (fast tier for basic, strong tier for reasoning)', () => {
    const multiCfg = config({
      ...live,
      modelName: 'gpt-4o',
      modelNames: ['gpt-4o', 'gpt-4o-mini'],
    });
    // Default / strong
    expect(bestModelId(multiCfg)).toBe('gpt-4o');
    expect(bestModelId(multiCfg, 'strong')).toBe('gpt-4o');
    // Fast tier preference selects the fast model
    expect(bestModelId(multiCfg, 'fast')).toBe('gpt-4o-mini');
  });
});
