import { z } from 'zod';
import type { JsonSchemaObject, TripHints } from './types';

type JsonSchemaValue = Record<string, unknown>;

const MAX_WARNING = 200;

export interface ToolArgs {
  name: string;
  label: string;
  args: z.ZodType<Partial<TripHints>, z.ZodTypeDef, unknown>;
}

export type ParsedToolArgs =
  { ok: true; hints: Partial<TripHints> } | { ok: false; reason: string };

/**
 * JSON Schema for the provider, derived from the same zod schema used to
 * validate the model's arguments. Supports the subset the tool catalog uses;
 * an unsupported node is a programmer error, not a traveler error.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  const base = unwrap(schema);
  if (!(base instanceof z.ZodObject)) {
    throw new Error('Tool arguments must be a zod object');
  }
  const shape = base.shape as Record<string, z.ZodTypeAny>;
  const properties: Record<string, JsonSchemaValue> = {};
  const required: string[] = [];
  for (const [key, node] of Object.entries(shape)) {
    properties[key] = { ...valueSchema(unwrap(node)), ...description(node) };
    if (!node.isOptional()) required.push(key);
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

/**
 * Validate one model call. A payload that does not match is rejected with a
 * reason for the log; it is never coerced into something the tool would accept.
 */
export function parseToolArgs(tool: ToolArgs, raw: string): ParsedToolArgs {
  const trimmed = raw.trim();
  let value: unknown;
  if (!trimmed) {
    value = {};
  } else {
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { ok: false, reason: 'arguments were not valid JSON' };
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'arguments were not a JSON object' };
  }
  const parsed = tool.args.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') || 'arguments';
    const message = issue?.message ?? 'did not match the schema';
    return { ok: false, reason: truncate(`${path}: ${message}`) };
  }
  return { ok: true, hints: parsed.data };
}

/** Traveler-facing sentence for a call that was rejected. */
export function rejectionSummary(tool: ToolArgs): string {
  return `I could not read that ${tool.label} request, so I did not run it.`;
}

export function rejectionWarning(reason: string): string {
  return truncate(reason);
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let node = schema;
  while (node instanceof z.ZodOptional || node instanceof z.ZodDefault) {
    node = node._def.innerType as z.ZodTypeAny;
  }
  while (node instanceof z.ZodEffects) {
    node = node._def.schema as z.ZodTypeAny;
  }
  return node;
}

function description(schema: z.ZodTypeAny): JsonSchemaValue {
  return schema.description ? { description: schema.description } : {};
}

function valueSchema(node: z.ZodTypeAny): JsonSchemaValue {
  if (node instanceof z.ZodString) {
    const out: JsonSchemaValue = { type: 'string' };
    for (const check of node._def.checks) {
      // JSON Schema wants the pattern source, not a /wrapped/ literal.
      if (check.kind === 'regex') out.pattern = check.regex.source;
      if (check.kind === 'min') out.minLength = check.value;
      if (check.kind === 'max') out.maxLength = check.value;
    }
    return out;
  }
  if (node instanceof z.ZodNumber) {
    const out: JsonSchemaValue = {
      type: node._def.checks.some((check) => check.kind === 'int') ? 'integer' : 'number',
    };
    for (const check of node._def.checks) {
      if (check.kind === 'min') {
        out[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
      }
      if (check.kind === 'max') {
        out[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
      }
    }
    return out;
  }
  if (node instanceof z.ZodEnum) {
    return { type: 'string', enum: [...node.options] };
  }
  if (node instanceof z.ZodArray) {
    return { type: 'array', items: valueSchema(unwrap(node._def.type)) };
  }
  throw new Error(`Unsupported zod type for a tool argument: ${node._def.typeName}`);
}

function truncate(value: string): string {
  return value.length > MAX_WARNING ? `${value.slice(0, MAX_WARNING)}…` : value;
}
