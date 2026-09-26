import { addDays } from './dates';
import { extractHints } from './extract';
import { parseToolArgs, rejectionSummary, rejectionWarning } from './tool-args';
import { findTool, MAX_TOOLS_PER_TURN, runTool } from './tools';
import type {
  ModelToolCall,
  ToolContext,
  ToolResult,
  ToolSource,
  TripHints,
} from './types';

export interface PlannedToolCall {
  source: ToolSource;
  name: string;
  /** Arguments from the model, already validated. Empty for a router call. */
  hints: Partial<TripHints>;
}

export interface ToolPlan {
  calls: PlannedToolCall[];
  /** Calls that never ran: unknown tool names, or arguments that did not validate. */
  rejected: ToolResult[];
}

/**
 * Decide what runs this turn. The model's calls come first; the router fills any
 * remaining slots from the traveler's text. A tool the model already ran is not
 * run again, and the ceiling counts model and router executions together.
 */
export function planToolCalls(input: {
  text: string;
  routerNames: string[];
  modelCalls: ModelToolCall[];
}): ToolPlan {
  const calls: PlannedToolCall[] = [];
  const rejected: ToolResult[] = [];
  const executed = new Set<string>();
  const rejectedNames = new Set<string>();

  for (const call of input.modelCalls) {
    if (calls.length >= MAX_TOOLS_PER_TURN) break;
    const tool = findTool(call.name);
    if (!tool) {
      if (rejected.length >= MAX_TOOLS_PER_TURN || rejectedNames.has(call.name)) continue;
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
    if (executed.has(tool.name) || rejectedNames.has(tool.name)) continue;
    const parsed = parseToolArgs(tool, call.arguments);
    if (!parsed.ok) {
      rejectedNames.add(tool.name);
      if (rejected.length < MAX_TOOLS_PER_TURN) {
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
    executed.add(tool.name);
    calls.push({ source: 'model', name: tool.name, hints: parsed.hints });
  }

  for (const name of input.routerNames) {
    if (calls.length >= MAX_TOOLS_PER_TURN) break;
    const tool = findTool(name);
    // A tool that already ran is not run twice. A rejected model call is not
    // "already run": the router may cover it from the traveler's own words.
    if (!tool || executed.has(tool.name)) continue;
    executed.add(tool.name);
    calls.push({ source: 'router', name: tool.name, hints: {} });
  }

  return { calls, rejected };
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
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of plan.calls) {
    const tool = findTool(call.name);
    if (!tool) continue;
    const hints = mergeHints(text, call.hints);
    results.push(await runTool(tool, text, hints, call.source, ctx));
  }
  const executed = new Set(results.map((result) => result.name));
  return [...results, ...plan.rejected.filter((item) => !executed.has(item.name))];
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
