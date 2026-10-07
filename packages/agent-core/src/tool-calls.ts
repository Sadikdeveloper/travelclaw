import { addDays } from './dates';
import { extractHints } from './extract';
import { parseToolArgs, rejectionSummary, rejectionWarning } from './tool-args';
import { findTool, MAX_TOOLS_PER_TURN, runTool, type ToolRunHooks } from './tools';
import type {
  ModelToolCall,
  ToolContext,
  ToolResult,
  ToolSource,
  TripHints,
} from './types';

export type { ToolRunHooks };

export interface PlannedToolCall {
  source: ToolSource;
  name: string;
  /** Arguments from the model, already validated. Empty for a router call. */
  hints: Partial<TripHints>;
  /** The model's raw argument JSON, kept only to show what it asked for. */
  args?: string;
}

export interface ToolPlan {
  calls: PlannedToolCall[];
  /** Calls that never ran: unknown tool names, or arguments that did not validate. */
  rejected: ToolResult[];
  /**
   * Calls the desk refused before running them: a per-turn limit was reached, or
   * this turn already proved the tool dead. Kept apart from `rejected` because
   * nothing was wrong with the call itself — it is a verdict, not a malformed
   * request, and it is shown to the model either way.
   */
  blocked: ToolResult[];
  /** Calls an earlier pass of this same turn already ran, and was not repeated. */
  repeated: number;
}

/**
 * A per-turn ceiling for a tool that is cheap to call, easy to loop on, and
 * never the source of a price. Hermes caps `web_search` for the same reason and
 * with the same remedy: at the limit the call is refused with a sentence that
 * says what to do instead, so a model that wanted to search again answers from
 * what it already has. Three executions a turn is the whole budget; this stops
 * one tool from spending it on the same kind of page three times.
 */
export const TOOL_CALL_LIMITS: Record<string, number> = {
  'web.search': 2,
};

/**
 * The identity of a call inside one turn: the tool, and the arguments it was
 * asked with. Asking for the same thing twice in one turn earns nothing — the
 * result is already in the model's context — while the same tool with new
 * arguments (a second search, a different page) is real work and still runs.
 */
export function toolCallKey(name: string, args: string | undefined): string {
  return `${name}:${(args ?? '').slice(0, 600)}`;
}

/**
 * Decide what runs this turn. The model's calls come first; the router fills any
 * remaining slots from the traveler's text. A tool the model already ran is not
 * run again, and the ceiling counts model and router executions together.
 *
 * `remaining` is what is left of the ceiling when an earlier pass already ran
 * tools; without it the ceiling is the whole turn's budget.
 *
 * Two refusals happen here rather than in the tool: a call past a tool's
 * per-turn limit, and a call to a tool this turn already failed for a reason a
 * retry cannot fix. Both come back as a `blocked` result carrying a sentence for
 * the model, which is how a loop gets named instead of merely starved.
 */
export function planToolCalls(input: {
  text: string;
  routerNames: string[];
  modelCalls: ModelToolCall[];
  remaining?: number;
  /** Keys (`toolCallKey`) of calls already run earlier in this same turn. */
  ran?: string[];
  /** Names of tools already run earlier in this turn, whatever they were asked. */
  ranTools?: string[];
  /** Tools that failed for a reason a retry cannot fix, with that reason. */
  dead?: Record<string, string>;
}): ToolPlan {
  const ceiling = Math.max(
    0,
    Math.min(input.remaining ?? MAX_TOOLS_PER_TURN, MAX_TOOLS_PER_TURN),
  );
  const calls: PlannedToolCall[] = [];
  const rejected: ToolResult[] = [];
  const blocked: ToolResult[] = [];
  const executedKeys = new Set<string>(input.ran ?? []);
  const executedNames = new Set<string>(input.ranTools ?? []);
  const rejectedNames = new Set<string>();
  let repeated = 0;
  if (!ceiling) return { calls, rejected, blocked, repeated };

  /** Executions of one tool this turn: the ones that ran, plus the ones queued here. */
  const used = (name: string): number =>
    (input.ranTools?.filter((ran) => ran === name).length ?? 0) +
    calls.filter((call) => call.name === name).length;

  for (const call of input.modelCalls) {
    if (calls.length >= ceiling) break;
    const tool = findTool(call.name);
    if (!tool) {
      if (rejected.length >= ceiling || rejectedNames.has(call.name)) continue;
      rejectedNames.add(call.name);
      rejected.push(
        rejection({
          name: call.name || 'unknown',
          summary:
            'That request named a tool that is not on this desk, so I did not run it.',
          warning: `unknown tool ${call.name}`,
        }),
      );
      continue;
    }
    const key = toolCallKey(tool.name, call.arguments);
    if (executedKeys.has(key)) {
      repeated += 1;
      continue;
    }
    if (rejectedNames.has(tool.name)) continue;
    const deadReason = input.dead?.[tool.name];
    if (deadReason) {
      blocked.push(
        blockedCall({
          name: tool.name,
          summary: `Blocked ${tool.name}: it already failed this turn for a reason a retry cannot fix — ${deadReason} Ask the traveler for what is missing, or state the limit plainly, instead of calling it again.`,
          warning: `${tool.name} is terminal this turn: ${deadReason}`,
        }),
      );
      continue;
    }
    const limit = TOOL_CALL_LIMITS[tool.name];
    if (limit !== undefined && used(tool.name) >= limit) {
      blocked.push(
        blockedCall({
          name: tool.name,
          summary: `Blocked ${tool.name}: this turn has already run it ${limit} time${limit === 1 ? '' : 's'}, which is the per-turn limit. This looks like a loop. Answer from the results already in context, and say plainly what they do not establish.`,
          warning: `${tool.name} reached its per-turn limit of ${limit}`,
        }),
      );
      continue;
    }
    const parsed = parseToolArgs(tool, call.arguments);
    if (!parsed.ok) {
      rejectedNames.add(tool.name);
      if (rejected.length < ceiling) {
        rejected.push(
          rejection({
            name: tool.name,
            summary: rejectionSummary(tool),
            warning: `${tool.name}: ${rejectionWarning(parsed.reason)}`,
          }),
        );
      }
      continue;
    }
    executedKeys.add(key);
    executedNames.add(tool.name);
    calls.push({
      source: 'model',
      name: tool.name,
      hints: parsed.hints,
      args: call.arguments.slice(0, 600),
    });
  }

  for (const name of input.routerNames) {
    if (calls.length >= ceiling) break;
    const tool = findTool(name);
    // A call that already ran is not run twice. A rejected model call is not
    // "already run": the router may cover it from the traveler's own words.
    if (!tool || executedNames.has(tool.name)) continue;
    // A router pick is the desk's own choice, so a limit or a dead tool is
    // dropped quietly: there is no request from the traveler to answer back to.
    if (input.dead?.[name]) continue;
    const limit = TOOL_CALL_LIMITS[name];
    if (limit !== undefined && used(name) >= limit) continue;
    executedNames.add(tool.name);
    executedKeys.add(toolCallKey(tool.name, undefined));
    calls.push({ source: 'router', name: tool.name, hints: {} });
  }

  return { calls, rejected, blocked, repeated };
}

/**
 * Execute a plan in order, then append the rejections the traveler still needs
 * to hear about. A rejection for a tool that did run (the router covering for a
 * malformed model call) is dropped: the executed result is the honest one.
 */
export async function runToolPlan(
  plan: ToolPlan,
  text: string,
  ctx: ToolContext,
  hooks?: ToolRunHooks,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const [index, call] of plan.calls.entries()) {
    const tool = findTool(call.name);
    if (!tool) continue;
    const hints = mergeHints(text, call.hints);
    results.push(
      await execute(tool, text, hints, call.source, ctx, hooks, index, call.args),
    );
  }
  const executed = new Set(results.map((result) => result.name));
  return [
    ...results,
    ...plan.blocked,
    ...plan.rejected.filter((item) => !executed.has(item.name)),
  ];
}

/** Announce, run, announce — one tool, one place that knows how. */
async function execute(
  tool: Parameters<typeof runTool>[0],
  text: string,
  hints: TripHints,
  source: ToolSource,
  ctx: ToolContext,
  hooks: ToolRunHooks | undefined,
  index: number,
  args?: string,
): Promise<ToolResult> {
  hooks?.start?.({ index, name: tool.name, source, ...(args ? { args } : {}) });
  const result = await runTool(tool, text, hints, source, ctx);
  hooks?.end?.({ index, name: result.name, ok: result.ok, summary: result.summary });
  return result;
}

/** Router hints from the text, with the model's arguments winning where present. */
export function mergeHints(text: string, fromModel: Partial<TripHints>): TripHints {
  const base = extractHints(text);
  const merged: TripHints = { ...base, ...definedOnly(fromModel) };
  merged.interests = fromModel.interests ?? base.interests;
  // A model may answer with a start date and a length instead of an end date.
  if (merged.startDate && !merged.endDate && merged.days && merged.days > 0) {
    merged.endDate = addDays(merged.startDate, merged.days - 1) ?? undefined;
  }
  return merged;
}

function definedOnly(input: Partial<TripHints>): Partial<TripHints> {
  const out = {} as Partial<TripHints>;
  for (const key of Object.keys(input) as Array<keyof TripHints>) {
    const value = input[key];
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function rejection(input: { name: string; summary: string; warning: string }): ToolResult {
  return {
    name: input.name,
    ok: false,
    summary: input.summary,
    data: null,
    warning: input.warning,
    source: 'model',
  };
}

/**
 * A call the desk refused before running it. It reads as `ok: false` because
 * there is no result, but `blocked` keeps it out of every failure count: the
 * tool did not fail, the desk declined, and the sentence in `summary` is what
 * tells the model what to do instead.
 */
function blockedCall(input: {
  name: string;
  summary: string;
  warning: string;
}): ToolResult {
  return { ...rejection(input), blocked: true };
}
