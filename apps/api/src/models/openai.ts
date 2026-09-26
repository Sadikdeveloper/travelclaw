import type { HistoryTurn, ModelToolCall, ModelToolSpec } from '@travelclaw/agent-core';

/**
 * Translation between the turn loop's provider contract and OpenAI-compatible
 * chat completions. Kept as pure functions so the shapes can be tested without
 * a network call.
 */

export interface OpenAiToolPayload {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export function openAiToolsPayload(
  tools: ModelToolSpec[] | undefined,
): OpenAiToolPayload[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function openAiRequestBody(input: {
  model: string;
  system: string;
  history: HistoryTurn[];
  user: string;
  tools?: ModelToolSpec[];
}): Record<string, unknown> {
  const tools = openAiToolsPayload(input.tools);
  return {
    model: input.model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: input.system },
      ...input.history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user', content: input.user },
    ],
    ...(tools ? { tools, tool_choice: 'auto' } : {}),
  };
}

/** Reads a completion. A message with tool calls may carry no text at all. */
export function parseOpenAiMessage(body: unknown): {
  text: string;
  toolCalls: ModelToolCall[];
} {
  const choice = (
    body as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> }
  )?.choices?.[0]?.message;
  const text = typeof choice?.content === 'string' ? choice.content : '';
  const raw = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
  return { text, toolCalls: raw.flatMap(parseToolCall) };
}

function parseToolCall(raw: unknown): ModelToolCall[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
  const name = typeof call.function?.name === 'string' ? call.function.name : '';
  if (!name) return [];
  return [
    {
      id: typeof call.id === 'string' && call.id ? call.id : name,
      name,
      arguments:
        typeof call.function?.arguments === 'string' ? call.function.arguments : '',
    },
  ];
}
