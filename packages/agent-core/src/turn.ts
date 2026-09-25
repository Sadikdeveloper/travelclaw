import { assemblePrompt } from './prompt';
import { renderFallback } from './reply';
import { BUNDLED_TOOLS, routeTools, runTools } from './tools';
import type {
  ModelProvider,
  RememberData,
  ToolContext,
  TurnRequest,
  TurnResult,
} from './types';

export function parseCommand(
  text: string,
): { name: 'tools' | 'remember' | 'new'; rest: string } | null {
  const match = /^\/(tools|remember|new)\b\s*([\s\S]*)$/i.exec(text.trim());
  if (!match) return null;
  return {
    name: match[1].toLowerCase() as 'tools' | 'remember' | 'new',
    rest: match[2].trim(),
  };
}

export function formatToolList(): string {
  return BUNDLED_TOOLS.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
}

export async function completeTurn(
  input: TurnRequest,
  deps: { provider: ModelProvider; ctx: ToolContext },
): Promise<TurnResult> {
  const command = parseCommand(input.text);
  if (command?.name === 'tools') {
    return {
      reply: `Tools on this desk:\n${formatToolList()}`,
      tools: [],
      toolResults: [],
      provider: 'desk',
      model: 'command',
      command: 'tools',
    };
  }
  if (command?.name === 'new') {
    return {
      reply: 'Session reset is handled by the gateway.',
      tools: [],
      toolResults: [],
      provider: 'desk',
      model: 'command',
      command: 'new',
    };
  }

  const text = command?.name === 'remember' ? `/remember ${command.rest}` : input.text;
  const names =
    command?.name === 'remember' ? ['memory.remember'] : routeTools(text).slice(0, 3);
  const toolResults = await runTools(text, names, deps.ctx);
  const remembered = toolResults.find(
    (result) => result.name === 'memory.remember' && result.ok,
  );
  const fallback = renderFallback(text, toolResults, input.persona.name);
  const system = assemblePrompt(input, toolResults);
  const completion = await deps.provider.complete({
    system,
    history: input.history.slice(-8),
    user: input.text,
    fallback,
  });
  return {
    reply: completion.text.trim() || fallback,
    tools: toolResults.map((result) => ({
      name: result.name,
      ok: result.ok,
      summary: result.summary,
    })),
    toolResults,
    provider: completion.provider,
    model: completion.model,
    remembered: remembered ? (remembered.data as RememberData) : undefined,
    command: command?.name,
  };
}

export function mockProvider(model = 'travelclaw-local'): ModelProvider {
  return {
    id: 'mock',
    model,
    async complete({ fallback }) {
      return { text: fallback, provider: 'mock', model };
    },
  };
}
