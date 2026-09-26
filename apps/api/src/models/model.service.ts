import { Injectable, Logger } from '@nestjs/common';
import { mockProvider, type ModelProvider } from '@travelclaw/agent-core';
import { loadConfig } from '../config';
import { openAiRequestBody, parseOpenAiMessage } from './openai';

/** What the desk rendering says when the live model is unavailable. */
const DESK = { provider: 'mock', model: 'travelclaw-local' } as const;

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

  current(): { provider: string; model: string } {
    const config = loadConfig();
    if (config.modelProvider === 'openai' && config.modelApiKey) {
      return { provider: 'openai', model: config.modelName };
    }
    return { provider: 'mock', model: 'travelclaw-local' };
  }

  provider(): ModelProvider {
    const config = loadConfig();
    if (config.modelProvider === 'openai' && config.modelApiKey) {
      return {
        id: 'openai',
        model: config.modelName,
        // The live model may ask for tools. The mock cannot, so it keeps the router.
        usesTools: true,
        complete: (input) => this.completeOpenAi(input, config),
      };
    }
    return mockProvider('travelclaw-local');
  }

  private async completeOpenAi(
    input: Parameters<ModelProvider['complete']>[0],
    config: ReturnType<typeof loadConfig>,
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
            model: config.modelName,
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
        model: config.modelName,
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
