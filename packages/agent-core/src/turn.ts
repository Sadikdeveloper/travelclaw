import { assemblePrompt } from './prompt';
import { renderFallback } from './reply';
import { planToolCalls, runToolPlan, toolCallKey, type ToolRunHooks } from './tool-calls';
import {
  BUNDLED_TOOLS,
  findTool,
  MAX_TOOLS_PER_TURN,
  routeTools,
  runTools,
  toolSpecs,
} from './tools';
import type {
  ModelCompletion,
  ModelDelta,
  ModelProvider,
  RememberData,
  ToolContext,
  ToolResult,
  TurnEventSink,
  TurnRequest,
  TurnResult,
} from './types';

/**
 * How many times a live model may be handed the tool catalog in one turn. The
 * extra passes let the desk chain real work (`web.search` → `web.fetch` → answer)
 * and recover when a model first narrates an intended retry instead of calling a
 * tool. The number of actual executions is still capped by `MAX_TOOLS_PER_TURN`.
 */
export const AGENTIC_TOOL_ROUNDS = 5;

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

export interface CompleteTurnDeps {
  provider: ModelProvider;
  ctx: ToolContext;
  /**
   * Times the provider may be offered tools. `1` is the original two-pass turn;
   * the live web UI opts into `AGENTIC_TOOL_ROUNDS` so searches can chain and retry.
   */
  toolRounds?: number;
  /** Where the desk reports what it is doing, in the order it happened. */
  onEvent?: TurnEventSink;
  /** Aborted when the traveler presses Stop; ends the provider call in flight. */
  signal?: AbortSignal;
}

export async function completeTurn(
  input: TurnRequest,
  deps: CompleteTurnDeps,
): Promise<TurnResult> {
  const emit: TurnEventSink = deps.onEvent ?? (() => {});
  const history = input.history.slice(-8);
  // What the model reads: the traveler's words, plus any gateway note (attachments).
  // Routing already runs on the raw text, so a note cannot steer tool choice.
  const userText = input.modelNote ? `${input.text}\n\n${input.modelNote}` : input.text;

  const command = parseCommand(input.text);
  if (command?.name === 'tools') {
    emit({ type: 'stage', id: 'command', label: 'Ran the /tools command', state: 'done' });
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

  deps.signal?.throwIfAborted();
  const text = command?.name === 'remember' ? `/remember ${command.rest}` : input.text;
  const routerNames =
    command?.name === 'remember' ? ['memory.remember'] : routeTools(text).slice(0, 3);

  emit({
    type: 'stage',
    id: 'read',
    label: 'Read your message',
    detail: `${input.memory.length} memory line${input.memory.length === 1 ? '' : 's'} and ${history.length} earlier message${history.length === 1 ? '' : 's'} in context.`,
    state: 'done',
  });

  // The tools this turn runs share its Stop, so a retried vendor call ends when
  // the traveler ends the turn.
  const ctx: ToolContext = deps.signal ? { ...deps.ctx, signal: deps.signal } : deps.ctx;
  // And a wait the model asks for is shown as a wait, not as a pause in which
  // nothing appears to be happening.
  const provider = waitingOutLoud(deps.provider, emit);

  const toolRounds = Math.max(1, Math.min(deps.toolRounds ?? 1, 5));
  const routerOnly = command?.name === 'remember' || deps.provider.usesTools !== true;
  // Did the answer reach the screen as the model wrote it? A round that turned
  // out to want a tool resets the draft, so this is not simply "a delta arrived".
  const answered = { streamed: false };

  let toolResults: ToolResult[];
  if (routerOnly) {
    emit({
      type: 'stage',
      id: 'plan',
      label: 'Chose what to run',
      detail: routerNames.length
        ? `The desk router picked ${routerNames.join(', ')}.`
        : 'Nothing on this desk needed a tool.',
      state: 'done',
    });
    toolResults = await runTools(text, routerNames, ctx, toolHooks(emit, 0));
  } else {
    const looped = await runModelRounds({
      input,
      deps,
      emit,
      userText,
      history,
      text,
      routerNames,
      ctx,
      provider,
      rounds: toolRounds,
      answered,
    });
    if (looped.answered) {
      // The model answered without asking for anything more. Everything that did
      // run on the way there is still this turn's grounding, and is returned as
      // such — a chain of tools is not discarded because the last pass was prose.
      const answeredResults = looped.results;
      const kept = answeredResults.find(
        (result) => result.name === 'memory.remember' && result.ok,
      );
      const reply =
        looped.answered.text.trim() ||
        renderFallback(text, answeredResults, input.persona.name);
      if (!answered.streamed) emit({ type: 'reply_delta', text: reply });
      emit({
        type: 'stage',
        id: 'write',
        label: 'Wrote the reply',
        detail: `${looped.answered.model || looped.answered.provider} answered.`,
        state: 'done',
      });
      return {
        reply,
        tools: tracesOf(answeredResults),
        toolResults: answeredResults,
        provider: looped.answered.provider,
        model: looped.answered.model,
        ...(kept ? { remembered: kept.data as RememberData } : {}),
        command: command?.name,
      };
    }
    toolResults = looped.results;
  }

  const remembered = toolResults.find(
    (result) => result.name === 'memory.remember' && result.ok,
  );
  const fallback = renderFallback(text, toolResults, input.persona.name);
  emit({
    type: 'stage',
    id: 'write',
    label: 'Writing the reply',
    detail: toolResults.length
      ? 'Grounding the answer in what ran above.'
      : 'No tool result to ground on, so the model answers from the desk files.',
    state: 'running',
  });

  deps.signal?.throwIfAborted();
  const completion = await provider.complete({
    system: assemblePrompt(input, toolResults, { toolCalling: false }),
    history,
    user: userText,
    fallback,
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...liveDeltas(deps, emit, answered),
  });
  let reply = completion.text.trim() || fallback;
  if (toolResults.some((result) => !result.ok) && isRetryAnnouncement(reply)) {
    // The last narration pass cannot call tools. If it still promises a retry,
    // replace that promise with the grounded desk result instead of saving it.
    if (answered.streamed) emit({ type: 'reply_reset' });
    answered.streamed = false;
    reply = fallback;
  }
  if (!answered.streamed) emit({ type: 'reply_delta', text: reply });
  emit({
    type: 'stage',
    id: 'write',
    label: 'Wrote the reply',
    detail: `${completion.model || completion.provider} answered.`,
    state: 'done',
  });

  return {
    reply,
    tools: tracesOf(toolResults),
    toolResults,
    provider: completion.provider,
    model: completion.model,
    remembered: remembered ? (remembered.data as RememberData) : undefined,
    command: command?.name,
  };
}

/**
 * The agentic part: offer the catalog, run what the model asks for, show it the
 * results, and let it ask again — inside one turn budget. The loop stops the
 * moment the model writes an answer instead of calling a tool, or when the
 * execution ceiling is reached, whichever comes first.
 */
async function runModelRounds(input: {
  input: TurnRequest;
  deps: CompleteTurnDeps;
  emit: TurnEventSink;
  userText: string;
  history: TurnRequest['history'];
  text: string;
  routerNames: string[];
  /** The tool context, carrying this turn's Stop. */
  ctx: ToolContext;
  /** The provider, wrapped so a retry is visible while it waits. */
  provider: ModelProvider;
  rounds: number;
  answered: { streamed: boolean };
}): Promise<{ results: ToolResult[]; answered?: ModelCompletion }> {
  const { deps, emit, text } = input;
  const results: ToolResult[] = [];
  // What this turn has already run, so a later pass cannot spend the budget
  // asking for the same thing again: the result is already in its context.
  const ran: string[] = [];
  const ranTools: string[] = [];
  let index = 0;

  for (let round = 0; round < input.rounds; round++) {
    deps.signal?.throwIfAborted();
    const first = round === 0;
    const roundStreamed = { streamed: false };
    const completion = await input.provider.complete({
      system: assemblePrompt(input.input, results, { toolCalling: true }),
      history: input.history,
      user: input.userText,
      fallback: renderFallback(text, results, input.input.persona.name),
      tools: toolSpecs(),
      ...(deps.signal ? { signal: deps.signal } : {}),
      ...liveDeltas(deps, emit, roundStreamed),
    });

    const plan = planToolCalls({
      text,
      routerNames: first ? input.routerNames : [],
      modelCalls: completion.toolCalls ?? [],
      remaining: Math.max(0, MAX_TOOLS_PER_TURN - results.length),
      ran,
      ranTools,
    });

    const requestedWork = plan.calls.length > 0 || plan.rejected.length > 0;
    if (requestedWork) {
      // The model wrote prose and then chose work instead. Take the draft back
      // rather than leaving words on screen that the turn is not going to keep.
      if (roundStreamed.streamed) emit({ type: 'reply_reset' });
      input.answered.streamed = false;
    }

    if (!requestedWork) {
      if (results.some((result) => !result.ok) && isRetryAnnouncement(completion.text)) {
        // A promise to retry is not the retry itself. Keep it out of the saved
        // answer, show a short action summary in the live process, and ask again
        // while this turn still has room for another distinct tool call.
        if (roundStreamed.streamed) emit({ type: 'reply_reset' });
        input.answered.streamed = false;
        emit({
          type: 'stage',
          id: `retry-${round}`,
          label: 'Checking another approach',
          detail:
            'The previous result was not usable; the remaining alternatives are being checked.',
          state: 'done',
        });
        emit({
          type: 'reasoning',
          text: 'The last result was not useful. I’m checking whether another available approach can help.',
        });
        if (round + 1 < input.rounds && results.length < MAX_TOOLS_PER_TURN) continue;
        break;
      }

      emit({
        type: 'stage',
        id: 'plan',
        label: results.length ? 'Decided it had enough' : 'Answered without tools',
        detail: results.length
          ? `${results.length} tool${results.length === 1 ? '' : 's'} ran; the model wrote the answer from them.`
          : 'Nothing on this desk matched, so the model answered from the desk files.',
        state: 'done',
      });
      // With nothing run yet, whatever the model wrote is the turn's answer. A
      // silent model after real tool work gets the narration pass instead, so
      // the results are never dropped on the floor.
      if (completion.text.trim() || !results.length) {
        input.answered.streamed = roundStreamed.streamed;
        return { results, answered: completion };
      }
      if (roundStreamed.streamed) emit({ type: 'reply_reset' });
      input.answered.streamed = false;
      break;
    }

    emit({
      type: 'stage',
      id: `plan-${round}`,
      label:
        round === 0 ? 'Chose what to run' : `Chose what to run next (pass ${round + 1})`,
      detail: [
        plan.calls.length
          ? `${plan.calls.length} tool${plan.calls.length === 1 ? '' : 's'}: ${plan.calls.map((call) => call.name).join(', ')}.`
          : 'No tool ran.',
        plan.rejected.length ? `${plan.rejected.length} call refused.` : '',
        plan.repeated
          ? `${plan.repeated} call already ran this turn and was not repeated.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      state: 'done',
    });

    const roundResults = await runToolPlan(plan, text, input.ctx, toolHooks(emit, index));
    index += plan.calls.length;
    results.push(...roundResults);
    ran.push(...plan.calls.map((call) => toolCallKey(call.name, call.args)));
    ranTools.push(...plan.calls.map((call) => call.name));
  }
  // The round budget is spent. What ran is still the turn's grounding, so the
  // narration pass below answers from it rather than from nothing.
  return { results };
}

/**
 * Some models narrate a retry as plain prose instead of emitting a tool call.
 * That sentence is useful progress, but it is not a completed answer. Keep this
 * deliberately narrow so a conditional offer like "I can search if you want"
 * still reads as a normal reply.
 */
function isRetryAnnouncement(text: string): boolean {
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const last = sentences
    .at(-1)
    ?.trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  if (!last || last.split(/\s+/).length > 36) return false;
  return /^(?:(?:okay|all right|so|hmm|next|then)\b[,:;—-]*\s*)*(?:let me|i(?:['’]ll| will|['’]m going to| am going to))\s+(?:now\s+)?(?:try|retry|check|search|look(?:\s+up)?|find|open|read|fetch|query|use|consult|explore)\b/i.test(
    last,
  );
}

/** Report every execution to the traveler's screen as it starts and ends. */
function toolHooks(emit: TurnEventSink, startIndex: number): ToolRunHooks {
  return {
    start: (call) => {
      const tool = findTool(call.name);
      emit({
        type: 'tool_start',
        id: `tool-${startIndex + call.index}`,
        name: call.name,
        label: tool?.label ?? call.name,
        source: call.source,
        ...(call.args ? { args: call.args } : {}),
      });
    },
    end: (call) => {
      emit({
        type: 'tool_end',
        id: `tool-${startIndex + call.index}`,
        name: call.name,
        ok: call.ok,
        summary: call.summary,
      });
    },
  };
}

/**
 * A model call that is going to wait and ask again says so, once, and closes
 * the note when the answer lands. OpenClaw shows the same single transient
 * indicator; a traveler who can see the desk is waiting does not press Stop or
 * reload, and Stop keeps working throughout the wait anyway.
 */
function waitingOutLoud(provider: ModelProvider, emit: TurnEventSink): ModelProvider {
  return {
    ...provider,
    complete: async (input) => {
      let attempt = 0;
      try {
        return await provider.complete({
          ...input,
          onWait: (info) => {
            attempt = info.attempt;
            input.onWait?.(info);
            emit({
              type: 'stage',
              id: 'retry',
              label: 'Waiting to ask again',
              detail: `${info.reason} Asking again in ${seconds(info.delayMs)}.`,
              state: 'running',
            });
          },
        });
      } finally {
        // Left open, the step would still be spinning in a trail that has
        // finished.
        if (attempt) {
          emit({
            type: 'stage',
            id: 'retry',
            label: 'Asked again',
            detail: `Finished on attempt ${attempt + 1}.`,
            state: 'done',
          });
        }
      }
    },
  };
}

/** `1200` → `1.2s`, the way a person reads a wait. */
function seconds(ms: number): string {
  return `${Math.max(0.1, Math.round(ms / 100) / 10)}s`;
}

/**
 * Stream only when a screen is watching. The plain POST path asks for one
 * finished answer, so a streaming-capable provider is not asked to stream into
 * nowhere (and a non-streaming body is never parsed as if it were SSE).
 */
function liveDeltas(
  deps: CompleteTurnDeps,
  emit: TurnEventSink,
  seen: { streamed: boolean },
): { onDelta?: (delta: ModelDelta) => void } {
  if (!deps.provider.streams || !deps.onEvent) return {};
  return {
    onDelta: (delta: ModelDelta) => {
      if (delta.reasoning) emit({ type: 'reasoning', text: delta.reasoning });
      if (delta.text) {
        seen.streamed = true;
        emit({ type: 'reply_delta', text: delta.text });
      }
    },
  };
}

function tracesOf(results: ToolResult[]) {
  return results.map((result) => ({
    name: result.name,
    ok: result.ok,
    summary: result.summary,
    source: result.source,
  }));
}

/** How the desk rendering is paced onto a screen that is watching it arrive. */
const DESK_CHUNK = 24;
const DESK_CHUNK_MS = 16;

/**
 * The desk's own rendering, handed over in slices rather than as one paragraph
 * at the end of the turn.
 *
 * A turn lands here when there is no key, or the configured provider refused the
 * model id. The traveler is watching a process view either way, and a view that
 * stays silent for the whole turn and then jumps straight to a finished answer
 * reads as a hang — which is the opposite of what happened. Nothing is invented
 * to fill the gap: the slices add up to exactly the fallback text, and the
 * completion returns that same string.
 */
export function mockProvider(model = 'travelclaw-local'): ModelProvider {
  return {
    id: 'mock',
    model,
    // The desk cannot call tools, so the turn keeps its router-only path.
    usesTools: false,
    streams: true,
    async complete({ fallback, signal, onDelta }) {
      if (onDelta) {
        for (const chunk of readingChunks(fallback, DESK_CHUNK)) {
          if (signal?.aborted) break;
          onDelta({ text: chunk });
          await pause(signal, DESK_CHUNK_MS);
        }
      }
      return { text: fallback, provider: 'mock', model };
    },
  };
}

/**
 * Split on code points, not UTF-16 units: a plain `.{1,24}` cut would slice an
 * emoji or a surrogate pair in half and put a lone surrogate on the wire.
 */
function readingChunks(text: string, size: number): string[] {
  const points = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < points.length; index += size) {
    chunks.push(points.slice(index, index + size).join(''));
  }
  return chunks;
}

/** The gap between slices, cut short by Stop so a stopped turn stops at once. */
function pause(signal: AbortSignal | undefined, ms: number): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
