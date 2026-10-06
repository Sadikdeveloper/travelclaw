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
  stream?: boolean;
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
    ...(input.stream ? { stream: true } : {}),
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

/**
 * The streaming half: a chunk carries text, reasoning, or the next slice of a
 * tool call's arguments. Reasoning is provider-specific — DeepSeek and GLM send
 * `reasoning_content`, OpenRouter-style gateways send `reasoning` — so both are
 * read, and a provider with neither simply never sends the field.
 *
 * Tool calls arrive as partial arguments keyed by index, so the parser
 * accumulates them and only hands back complete calls at the end of the stream.
 */
export function createOpenAiStreamParser() {
  const calls = new Map<number, { id: string; name: string; args: string }>();
  return {
    push(payload: unknown): { text?: string; reasoning?: string; error?: string } {
      // A frame can be a failure instead of a chunk; it is read before anything
      // else, because an error frame carries no `choices` at all and would
      // otherwise parse as "nothing happened yet".
      const failure = streamError(payload);
      if (failure) return { error: failure };
      const choice = (
        payload as {
          choices?: Array<{
            delta?: {
              content?: unknown;
              reasoning_content?: unknown;
              reasoning?: unknown;
              tool_calls?: unknown;
            };
          }>;
        }
      )?.choices?.[0];
      const delta = choice?.delta;
      if (delta?.tool_calls) {
        for (const raw of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
          const entry = raw as {
            index?: unknown;
            id?: unknown;
            function?: { name?: unknown; arguments?: unknown };
          };
          const index = typeof entry.index === 'number' ? entry.index : 0;
          const current = calls.get(index) ?? { id: '', name: '', args: '' };
          if (typeof entry.id === 'string' && entry.id) current.id = entry.id;
          if (typeof entry.function?.name === 'string' && entry.function.name) {
            current.name = entry.function.name;
          }
          if (typeof entry.function?.arguments === 'string') {
            current.args += entry.function.arguments;
          }
          calls.set(index, current);
        }
      }
      const text = typeof delta?.content === 'string' ? delta.content : '';
      const reasoning =
        typeof delta?.reasoning_content === 'string'
          ? delta.reasoning_content
          : typeof delta?.reasoning === 'string'
            ? delta.reasoning
            : '';
      return {
        ...(text ? { text } : {}),
        ...(reasoning ? { reasoning } : {}),
      };
    },
    /** The tool calls assembled so far. Called once the stream has ended. */
    toolCalls(): ModelToolCall[] {
      return [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .flatMap(([, call]) =>
          call.name
            ? [{ id: call.id || call.name, name: call.name, arguments: call.args }]
            : [],
        );
    },
  };
}

/**
 * An upstream that fails *after* the stream has opened cannot answer with a
 * status code: the response is already `200 text/event-stream` and half the
 * answer may be on the wire. OpenAI-compatible aggregators — CodeCraft included
 * — send one frame holding `error`, then `data: [DONE]`, and close cleanly. So
 * every chunk has to be read for that key, or a failed upstream is
 * indistinguishable from a model that simply stopped talking early.
 *
 * Returns a sentence an operator can read. The message is the provider's own
 * wording; nothing else in the frame is echoed, since a provider may repeat
 * request details there.
 */
export function streamError(payload: unknown): string | null {
  const error = (payload as { error?: { message?: unknown; code?: unknown } } | null)
    ?.error;
  if (!error || typeof error !== 'object') return null;
  const message =
    typeof error.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'upstream provider error';
  const code =
    typeof error.code === 'number' || typeof error.code === 'string'
      ? ` (code ${error.code})`
      : '';
  return `${message}${code}`;
}

/** One `data:` line's payload, or null for the keep-alive/`[DONE]` frames. */
export function streamPayload(line: string): unknown | null {
  if (!line.startsWith('data:')) return null;
  const raw = line.slice(5).trim();
  if (!raw || raw === '[DONE]') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
