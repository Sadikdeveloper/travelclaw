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

  it('paces a bigger model tighter than a small one, and an account far above a guest', () => {
    const mini = limitsFor('gpt-4o-mini');
    const big = limitsFor('gpt-4o');
    const desk = limitsFor(DESK_MODEL_ID);
    expect(mini.guest).toBeGreaterThan(big.guest);
    expect(desk.guest).toBeGreaterThan(mini.guest);
    for (const limits of [desk, mini, big]) {
      expect(limits.account).toBeGreaterThan(limits.guest);
    }
    expect(limitsFor('some-new-model-2027').guest).toBeLessThanOrEqual(mini.guest);
  });
});
