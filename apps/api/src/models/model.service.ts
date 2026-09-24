import { Injectable, Logger } from '@nestjs/common';
import { mockProvider, type HistoryTurn, type ModelProvider } from '@travelclaw/agent-core';
import { loadConfig } from '../config';

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
        complete: (input) => this.completeOpenAi(input, config),
      };
    }
    return mockProvider('travelclaw-local');
  }

  private async completeOpenAi(
    input: { system: string; history: HistoryTurn[]; user: string; fallback: string },
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
        body: JSON.stringify({
          model: config.modelName,
          temperature: 0.3,
          messages: [
            { role: 'system', content: input.system },
            ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
            { role: 'user', content: input.user },
          ],
        }),
      });
      if (!response.ok) {
        this.logger.warn(`Model HTTP ${response.status}; using desk rendering`);
        return { text: input.fallback, provider: 'mock', model: 'travelclaw-local' };
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content;
      if (!text) return { text: input.fallback, provider: 'mock', model: 'travelclaw-local' };
      return { text, provider: 'openai', model: config.modelName };
    } catch (error) {
      this.logger.warn(`Model call failed; using desk rendering (${error instanceof Error ? error.message : 'error'})`);
      return { text: input.fallback, provider: 'mock', model: 'travelclaw-local' };
    } finally {
      clearTimeout(timer);
    }
  }
}
