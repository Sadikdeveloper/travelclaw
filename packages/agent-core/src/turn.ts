import { assemblePrompt } from './prompt';
import { renderFallback } from './reply';
import { planToolCalls, runToolPlan, type ToolPlan } from './tool-calls';
import { BUNDLED_TOOLS, routeTools, runTools, toolSpecs } from './tools';
import type {
  ModelProvider,
  RememberData,
  ToolContext,
  ToolResult,
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
  const routerNames =
    command?.name === 'remember' ? ['memory.remember'] : routeTools(text).slice(0, 3);
  const history = input.history.slice(-8);

  let toolResults: ToolResult[];
  if (command?.name === 'remember' || deps.provider.usesTools !== true) {
    // Offline, mock, or an explicit command: the router is the only caller.
    toolResults = await runTools(text, routerNames, deps.ctx);
  } else {
    // The model gets the catalog first. If it asks for nothing, the router
    // still runs, so a model that ignores tools cannot leave the turn ungrounded.
    const first = await deps.provider.complete({
      system: assemblePrompt(input, [], { toolCalling: true }),
      history,
      user: input.text,
      fallback: renderFallback(text, [], input.persona.name),
      tools: toolSpecs(),
    });
    const plan: ToolPlan = planToolCalls({
      text,
      routerNames,
      modelCalls: first.toolCalls ?? [],
    });
    toolResults = await runToolPlan(plan, text, deps.ctx);
    if (!toolResults.length) {
      // Nothing to ground: the model's own answer stands, or the desk speaks.
      return {
        reply: first.text.trim() || renderFallback(text, [], input.persona.name),
        tools: [],
        toolResults: [],
        provider: first.provider,
        model: first.model,
        command: command?.name,
      };
    }
  }

  const remembered = toolResults.find(
    (result) => result.name === 'memory.remember' && result.ok,
  );
  const fallback = renderFallback(text, toolResults, input.persona.name);
  const completion = await deps.provider.complete({
    system: assemblePrompt(input, toolResults),
    history,
    user: input.text,
    fallback,
  });
  const traces = toolResults.map((result) => ({
    name: result.name,
    ok: result.ok,
    summary: result.summary,
    source: result.source,
  }));
  return {
    reply: completion.text.trim() || fallback,
    tools: traces,
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
