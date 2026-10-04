import { createHash } from 'node:crypto';
import type { HistoryTurn, ModelToolCall, ModelToolSpec } from '@travelclaw/agent-core';

export interface CacheEntry {
  text: string;
  toolCalls?: ModelToolCall[];
  provider: string;
  model: string;
  createdAt: number;
}

/**
 * Model completion cache.
 *
 * Caches model responses for identical request context (model + system prompt + history + tools + input).
 * Reduces API costs and latency during iterative planning and repeated test turns.
 */
export class ModelCacheService {
  private readonly store = new Map<string, CacheEntry>();
  /** Default TTL: 1 hour */
  private readonly defaultTtlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs = 60 * 60 * 1000, maxSize = 500) {
    this.defaultTtlMs = ttlMs;
    this.maxSize = maxSize;
  }

  static computeKey(params: {
    model: string;
    system?: string;
    history?: HistoryTurn[];
    user?: string;
    tools?: ModelToolSpec[];
  }): string {
    const serialized = JSON.stringify({
      m: params.model,
      s: params.system ?? '',
      h: params.history ?? [],
      u: params.user ?? '',
      t: params.tools?.map((tool) => ({ n: tool.name, p: tool.parameters })) ?? [],
    });
    return createHash('sha256').update(serialized).digest('hex');
  }

  get(key: string): CacheEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.defaultTtlMs) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  set(
    key: string,
    result: { text: string; toolCalls?: ModelToolCall[]; provider: string; model: string },
  ): void {
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      text: result.text,
      toolCalls: result.toolCalls,
      provider: result.provider,
      model: result.model,
      createdAt: Date.now(),
    });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
