import { DESK_MODEL_ID, modelCatalog, limitsFor } from '../src/models/model-catalog';
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
    seed: false,
    taskDelayMs: 0,
    version: 'test',
    googleClientId: null,
    cookieSecure: false,
    cookieName: 'travelclaw_session',
    allowedOrigins: [],
    sessionTtlDays: 30,
    ...overrides,
  };
}

describe('model catalog', () => {
  it('always offers the offline desk model, and makes it the default without a key', () => {
    const catalog = modelCatalog(config({ modelName: 'gpt-4o-mini', modelNames: ['gpt-4o'] }));
    const desk = catalog.models.find((model) => model.id === DESK_MODEL_ID);
    expect(desk?.available).toBe(true);
    expect(desk?.offline).toBe(true);
    // A live model with no key is listed — so a picker can show what a key unlocks — but it
    // is not available, and nothing falls back to it.
    const live = catalog.models.find((model) => model.id === 'gpt-4o-mini');
    expect(live?.available).toBe(false);
    expect(catalog.current).toBe(DESK_MODEL_ID);
  });

  it('makes the configured model the default once it can actually run', () => {
    const catalog = modelCatalog(
      config({
        modelProvider: 'openai',
        modelApiKey: 'sk-test',
        modelName: 'gpt-4o',
        modelNames: ['gpt-4o', 'gpt-4o-mini'],
      }),
    );
    expect(catalog.current).toBe('gpt-4o');
    expect(catalog.models.filter((model) => model.available).map((model) => model.id)).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
      DESK_MODEL_ID,
    ]);
  });

  it('paces a bigger model tighter than a small one, and an account far above a guest', () => {
    const mini = limitsFor('gpt-4o-mini');
    const big = limitsFor('gpt-4o');
    const desk = limitsFor(DESK_MODEL_ID);
    expect(mini.guest).toBeGreaterThan(big.guest);
    expect(desk.guest).toBeGreaterThan(mini.guest);
    for (const limits of [desk, mini, big]) {
      expect(limits.account).toBeGreaterThan(limits.guest);
    }
  });

  it('paces a configured model it has never heard of, rather than granting it anything', () => {
    expect(limitsFor('some-new-model-2027').guest).toBeLessThanOrEqual(
      limitsFor('gpt-4o-mini').guest,
    );
    const catalog = modelCatalog(
      config({ modelProvider: 'openai', modelApiKey: 'sk-test', modelNames: ['some-new-model-2027'] }),
    );
    const entry = catalog.models.find((model) => model.id === 'some-new-model-2027');
    expect(entry?.label).toBe('some-new-model-2027');
    expect(entry?.available).toBe(true);
  });
});
