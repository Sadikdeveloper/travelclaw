import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { mockProvider, type ModelProvider } from '@travelclaw/agent-core';
import type { ModelCatalogRecord, ModelRecord } from '@travelclaw/shared';
import { loadConfig } from '../config';
import {
  DESK_MODEL_ID,
  bestModelId,
  credentialsFor,
  isLegacyGeminiModel,
  modelCatalog,
  resolveProvider,
} from './model-catalog';
import { openAiRequestBody, parseOpenAiMessage } from './openai';
import { ModelCacheService } from './model-cache.service';
import { formatModelList, listProviderModels } from './model-list';

/** What the desk rendering says when the live model is unavailable. */
const DESK = { provider: 'mock', model: DESK_MODEL_ID } as const;

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);
  readonly cache = new ModelCacheService();
  /**
   * One model-list lookup per base URL and key. A 404 is a configuration fact, not a
   * per-turn one, so a broken deployment pays for a single probe.
   */
  private readonly modelListCache = new Map<string, string>();

  constructor() {
    // A deployment still naming a Gemini 1.x/2.x model turns every live turn into a desk
    // rendering once its key stops serving that model. Say so at boot, once, rather than
    // only in the warning a failed turn leaves behind.
    const config = loadConfig();
    for (const id of new Set([config.modelName, ...config.modelNames])) {
      if (isLegacyGeminiModel(id)) {
        this.logger.warn(
          `Model ${id} is a legacy Gemini id: a key created after the Gemini 3 rollout answers HTTP 404 for it ("no longer available to new users"). Prefer gemini-3.8-flash or gemini-3.1-pro-preview; GET /v1beta/openai/models lists what a key can run.`,
        );
      }
    }
  }

  /** Every model on offer, the pace on each, and which one a turn runs on by default. */
  catalog(): ModelCatalogRecord {
    return modelCatalog(loadConfig());
  }

  /** What the health report calls the desk's model. */
  current(): { provider: string; model: string } {
    const { models, current } = this.catalog();
    const model = models.find((entry) => entry.id === current) ?? models[0];
    return { provider: model.provider, model: model.id };
  }

  /**
   * The model a turn runs on: the best available one this deployment has. Nobody chooses,
   * so there is no id to resolve and nothing to substitute — guests and signed-in accounts
   * are answered by the same model, and only the pace on it differs.
   * Can optionally request a 'fast' model for basic tasks or 'strong' model for complex reasoning/tools.
   */
  best(tierPreference?: 'fast' | 'strong'): ModelRecord {
    const config = loadConfig();
    const currentId = bestModelId(config, tierPreference);
    const { models } = this.catalog();
    return models.find((entry) => entry.id === currentId) ?? models[0];
  }

  providerFor(model: ModelRecord): ModelProvider {
    const config = loadConfig();
    if (model.offline || model.provider === 'mock') {
      return mockProvider(DESK_MODEL_ID);
    }

    // The catalog says which provider a model runs on; resolve it again here so a record
    // built by hand (or by an older catalog) cannot send an id to the wrong endpoint.
    const provider = resolveProvider(config, model.id);
    const { baseUrl, apiKey } = credentialsFor(config, provider);

    if (apiKey) {
      return {
        id: provider,
        model: model.id,
        // The live model may ask for tools. The mock cannot, so it keeps the router.
        usesTools: true,
        complete: (input) =>
          this.completeOpenAi(
            input,
            { ...config, modelBaseUrl: baseUrl, modelApiKey: apiKey },
            model.id,
            provider,
          ),
      };
    }
    return mockProvider(DESK_MODEL_ID);
  }

  private async completeOpenAi(
    input: Parameters<ModelProvider['complete']>[0],
    config: ReturnType<typeof loadConfig>,
    modelName: string,
    providerName = 'openai',
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`${config.modelBaseUrl}/chat/completions`, {
        method: 'POST',
        signal: input.signal
          ? AbortSignal.any([input.signal, controller.signal])
          : controller.signal,
        headers: {
          Authorization: `Bearer ${config.modelApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          openAiRequestBody({
            model: modelName,
            system: input.system,
            history: input.history,
            user: input.user,
            tools: input.tools,
          }),
        ),
      });
      if (!response.ok) {
        const hint =
          providerName === 'google' && response.status === 404
            ? ' Gemini could not find the configured endpoint or model; use the OpenAI-compatible `/v1beta/openai` base URL and a current model id such as `gemini-3.8-flash`.'
            : '';
        // Do not log an upstream response body: providers can echo request details
        // there. The provider/model/status is enough for an operator to diagnose a
        // bad base URL or retired model without exposing a key.
        this.logger.warn(
          `Model ${providerName}/${modelName} HTTP ${response.status}; using desk rendering.${hint}`,
        );
        if (response.status === 404) {
          this.logger.warn(
            await this.modelListNotice(
              providerName,
              config.modelBaseUrl,
              config.modelApiKey,
            ),
          );
        }
        return { text: input.fallback, ...DESK };
      }
      const { text, toolCalls } = parseOpenAiMessage(await response.json());
      if (!text && !toolCalls.length) {
        return { text: input.fallback, ...DESK };
      }
      return {
        text,
        provider: providerName,
        model: modelName,
        ...(toolCalls.length ? { toolCalls } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `Model call failed; using desk rendering (${error instanceof Error ? error.message : 'error'})`,
      );
      return { text: input.fallback, ...DESK };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * What a 404 cannot say. `GET /models` succeeds exactly when the base URL is right, and
   * names the ids when the model is the stale part — the difference between "retired model"
   * and "wrong endpoint" without logging a provider error body.
   */
  private async modelListNotice(
    provider: string,
    baseUrl: string,
    apiKey: string,
  ): Promise<string> {
    const cacheKey = `${baseUrl}\u0000${createHash('sha256').update(apiKey).digest('hex')}`;
    const cached = this.modelListCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const ids = await listProviderModels({ baseUrl, apiKey });
    const notice = ids
      ? `${provider} lists these models for this key: ${formatModelList(ids)}`
      : `${provider} model list unavailable; check the base URL and key.`;
    this.modelListCache.set(cacheKey, notice);
    return notice;
  }
}
