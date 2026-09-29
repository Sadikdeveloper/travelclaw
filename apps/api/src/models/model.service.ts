import { Injectable, Logger } from '@nestjs/common';
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
   * The model a turn runs on: the best available one this deployment has. Nobody chooses,
   * so there is no id to resolve and nothing to substitute — guests and signed-in accounts
   * are answered by the same model, and only the pace on it differs.
   */
  best(): ModelRecord {
    const { models, current } = this.catalog();
    return models.find((entry) => entry.id === current) ?? models[0];
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
