import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  mockProvider,
  type ModelCompletion,
  type ModelProvider,
} from '@travelclaw/agent-core';
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
import {
  createOpenAiStreamParser,
  openAiRequestBody,
  parseOpenAiMessage,
  streamPayload,
} from './openai';
import { ModelCacheService } from './model-cache.service';
import { formatModelList, listProviderModels } from './model-list';

/** What the desk rendering says when the live model is unavailable. */
const DESK = { provider: 'mock', model: DESK_MODEL_ID } as const;

/**
 * One SSE frame can carry `event:` and `data:` lines; the payload is the last
 * `data:` line. Frames without one (keep-alives, comments) are ignored.
 */
function lastDataLine(frame: string): string {
  const lines = frame.split('\n').filter((line) => line.startsWith('data:'));
  return lines.at(-1) ?? '';
}

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
        // And it can write the answer as it goes, so the traveler reads it live.
        streams: true,
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
    const streaming = Boolean(input.onDelta);
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
            stream: streaming,
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
      if (streaming) {
        return await this.readOpenAiStream(input, response.body, modelName, providerName);
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
      // A stopped turn is not a broken model. Hand the abort back to the turn
      // loop so a cancelled answer is neither replaced by desk rendering nor
      // saved as if the model had finished.
      if (input.signal?.aborted) throw error;
      this.logger.warn(
        `Model call failed; using desk rendering (${error instanceof Error ? error.message : 'error'})`,
      );
      return { text: input.fallback, ...DESK };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read an OpenAI-compatible SSE completion. Text and reasoning are handed to
   * `onDelta` the moment they arrive; tool-call fragments are accumulated and
   * returned with the text so the turn loop can run what the model asked for.
   *
   * A stream that dies mid-answer is not silently completed by the desk
   * rendering: the traveler keeps the words that actually arrived, with a line
   * saying the answer was cut off, because a half answer plus an honest note is
   * worth more than a plausible-looking substitution.
   */
  private async readOpenAiStream(
    input: Parameters<ModelProvider['complete']>[0],
    body: ReadableStream<Uint8Array> | null,
    modelName: string,
    providerName: string,
  ): Promise<ModelCompletion> {
    if (!body) return { text: input.fallback, ...DESK };
    const parser = createOpenAiStreamParser();
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let sawDelta = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Frames are separated by a blank line; the last partial frame stays buffered.
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const delta = parser.push(streamPayload(lastDataLine(frame)));
          if (delta.text) {
            text += delta.text;
            sawDelta = true;
            input.onDelta?.({ text: delta.text });
          }
          if (delta.reasoning) {
            sawDelta = true;
            input.onDelta?.({ reasoning: delta.reasoning });
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
      const delta = parser.push(streamPayload(lastDataLine(buffer)));
      if (delta.text) {
        text += delta.text;
        input.onDelta?.({ text: delta.text });
      }
      if (delta.reasoning) input.onDelta?.({ reasoning: delta.reasoning });
      const toolCalls = parser.toolCalls();
      // Nothing at all came back — a provider that accepted `stream` and then
      // said nothing is the same failure as an empty completion.
      if (!text && !toolCalls.length && !sawDelta) return { text: input.fallback, ...DESK };
      return {
        text,
        provider: providerName,
        model: modelName,
        ...(toolCalls.length ? { toolCalls } : {}),
      };
    } catch (error) {
      // Stop, or a tab that went away: the answer is being cancelled on purpose,
      // so the partial text is not dressed up as a finished reply.
      if (input.signal?.aborted) throw error;
      if (text.trim()) {
        this.logger.warn(
          `Model ${providerName}/${modelName} stream interrupted; keeping the partial answer`,
        );
        input.onDelta?.({
          text: '\n\n(That answer was cut off — the model connection dropped.)',
        });
        return { text, provider: providerName, model: modelName };
      }
      this.logger.warn(
        `Model stream failed; using desk rendering (${error instanceof Error ? error.message : 'error'})`,
      );
      return { text: input.fallback, ...DESK };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
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
