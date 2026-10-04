import { ModelCacheService } from '../src/models/model-cache.service';

describe('ModelCacheService', () => {
  it('computes deterministic SHA-256 keys for identical requests', () => {
    const key1 = ModelCacheService.computeKey({
      model: 'gpt-4o',
      system: 'You are Marlow.',
      history: [{ role: 'user', content: 'Hello' }],
      user: 'Plan Paris',
      tools: [
        {
          name: 'trip.outline',
          description: 'Outline',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    });
    const key2 = ModelCacheService.computeKey({
      model: 'gpt-4o',
      system: 'You are Marlow.',
      history: [{ role: 'user', content: 'Hello' }],
      user: 'Plan Paris',
      tools: [
        {
          name: 'trip.outline',
          description: 'Outline',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    });
    const diffKey = ModelCacheService.computeKey({
      model: 'gpt-4o',
      system: 'You are Marlow.',
      history: [{ role: 'user', content: 'Hello' }],
      user: 'Plan London',
    });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(diffKey);
    expect(key1).toHaveLength(64); // SHA-256 hex string
  });

  it('stores and retrieves cached model results', () => {
    const cache = new ModelCacheService();
    const key = ModelCacheService.computeKey({
      model: 'gpt-4o-mini',
      user: 'Hi there',
    });

    expect(cache.get(key)).toBeNull();

    cache.set(key, {
      text: 'Hello, how can I help with your travel?',
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    const hit = cache.get(key);
    expect(hit).not.toBeNull();
    expect(hit?.text).toBe('Hello, how can I help with your travel?');
    expect(hit?.provider).toBe('openai');
    expect(cache.size).toBe(1);
  });

  it('expires items after the specified TTL', async () => {
    const shortCache = new ModelCacheService(30); // 30ms TTL
    const key = ModelCacheService.computeKey({
      model: 'grok-2',
      user: 'Quick question',
    });

    shortCache.set(key, {
      text: 'Quick answer',
      provider: 'xai',
      model: 'grok-2',
    });

    expect(shortCache.get(key)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shortCache.get(key)).toBeNull();
  });

  it('evicts oldest entries when maxSize is reached', () => {
    const smallCache = new ModelCacheService(60000, 2);
    const k1 = 'key1';
    const k2 = 'key2';
    const k3 = 'key3';

    smallCache.set(k1, { text: '1', provider: 'mock', model: 'm1' });
    smallCache.set(k2, { text: '2', provider: 'mock', model: 'm2' });
    expect(smallCache.size).toBe(2);

    smallCache.set(k3, { text: '3', provider: 'mock', model: 'm3' });
    expect(smallCache.size).toBe(2);
    expect(smallCache.get(k1)).toBeNull();
    expect(smallCache.get(k2)).not.toBeNull();
    expect(smallCache.get(k3)).not.toBeNull();
  });
});
