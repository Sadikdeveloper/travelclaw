import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { mockProvider, type ModelProvider } from '@travelclaw/agent-core';
import type { ModelCatalogRecord, ModelRecord } from '@travelclaw/shared';
import { loadConfig } from '../config';
import { DESK_MODEL_ID, modelCatalog } from './model-catalog';
import { openAiRequestBody, parseOpenAiMessage } from './openai';

/** What the desk rendering says when the live model is unavailable. */
const DESK = { provider: 'mock', model: DESK_MODEL_ID } as const;

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

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
   * The model a turn should run on: the one the request named, or the desk's default.
   * A named model that does not exist, or exists but cannot run, is an error — a traveler
   * who asked for a specific model must never be served by a different one silently.
   */
  resolve(id?: string): ModelRecord {
    const { models, current } = this.catalog();
    if (!id) return models.find((entry) => entry.id === current) ?? models[0];
    const model = models.find((entry) => entry.id === id);
    if (!model) {
      throw new BadRequestException({
        code: 'model_unknown',
        message: `This desk does not run "${id}".`,
      });
    }
    if (!model.available) {
      throw new BadRequestException({
        code: 'model_unavailable',
        message: `${model.label} is not available yet — it needs a provider key. The desk model works without one.`,
      });
    }
    return model;
  }

  providerFor(model: ModelRecord): ModelProvider {
    const config = loadConfig();
    if (model.provider === 'openai' && config.modelApiKey) {
      return {
        id: 'openai',
        model: model.id,
        // The live model may ask for tools. The mock cannot, so it keeps the router.
        usesTools: true,
        complete: (input) => this.completeOpenAi(input, config, model.id),
      };
    }
    return mockProvider(DESK_MODEL_ID);
  }

  private async completeOpenAi(
    input: Parameters<ModelProvider['complete']>[0],
    config: ReturnType<typeof loadConfig>,
    modelName: string,
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`${config.modelBaseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
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
        this.logger.warn(`Model HTTP ${response.status}; using desk rendering`);
        return { text: input.fallback, ...DESK };
      }
      const { text, toolCalls } = parseOpenAiMessage(await response.json());
      if (!text && !toolCalls.length) {
        return { text: input.fallback, ...DESK };
      }
      return {
        text,
        provider: 'openai',
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
}
