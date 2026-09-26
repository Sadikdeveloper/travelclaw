import type { ModelCatalogRecord, ModelLimits, ModelRecord } from '@travelclaw/shared';
import type { AppConfig } from '../config';

/** Every turn limit on this desk is measured over this window. */
export const TURN_WINDOW_MS = 10 * 60 * 1000;

/** The desk's own renderer: deterministic, offline, and the one model always offered. */
export const DESK_MODEL_ID = 'travelclaw-local';

/**
 * The models this desk can run, best first.
 *
 * `rank` is which model the desk reaches for when it is free to choose, and turns per ten
 * minutes is what each one costs a traveler to use. Both are policy: a bigger model is
 * rationed tighter than a small one, and an account's allowance is several times a guest's.
 * Adding a model is one entry here plus its name in TRAVELCLAW_MODELS.
 */
const KNOWN_MODELS: {
  id: string;
  label: string;
  rank: number;
  limits: ModelLimits;
}[] = [
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    rank: 30,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'o4-mini',
    label: 'o4-mini',
    rank: 20,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    rank: 10,
    limits: { guest: 5, account: 30 },
  },
  {
    id: DESK_MODEL_ID,
    label: 'Desk model',
    rank: 0,
    // Runs in this process: no provider call, no key, no per-turn cost.
    limits: { guest: 15, account: 60 },
  },
];

/**
 * A configured model the desk has never heard of. It beats the offline desk model — the
 * operator named it and gave it a key — but loses to any model the desk knows the size of,
 * because ranking something we cannot describe would be a guess.
 */
const UNKNOWN_RANK = 1;

/** A configured model we have no entry for is served, but paced conservatively. */
const UNKNOWN_LIMITS: ModelLimits = { guest: 3, account: 20 };

export function limitsFor(id: string): ModelLimits {
  return KNOWN_MODELS.find((model) => model.id === id)?.limits ?? UNKNOWN_LIMITS;
}

export function labelFor(id: string): string {
  return KNOWN_MODELS.find((model) => model.id === id)?.label ?? id;
}

function rankFor(id: string): number {
  return KNOWN_MODELS.find((model) => model.id === id)?.rank ?? UNKNOWN_RANK;
}

/**
 * The models configured on this deployment, in the order a person listed them, with the
 * desk's own model always present as the floor.
 */
function configuredIds(config: AppConfig): string[] {
  const ids = [config.modelName, ...config.modelNames].filter(
    (id, index, all) => id !== '' && all.indexOf(id) === index,
  );
  if (!ids.includes(DESK_MODEL_ID)) ids.push(DESK_MODEL_ID);
  return ids;
}

function entryFor(config: AppConfig, id: string): ModelRecord {
  const offline = id === DESK_MODEL_ID;
  return {
    id,
    label: labelFor(id),
    provider: offline ? 'mock' : 'openai',
    limits: limitsFor(id),
    offline,
    available: offline || config.modelApiKey !== '',
  };
}

/**
 * The model a turn runs on: the strongest available one this deployment actually has.
 *
 * Nobody picks a model — not a guest, not a signed-in account, and not the request. Using up
 * one model's pace never moves a traveler onto another model; it only stops them, with a
 * message saying which model ran out.
 */
export function bestModelId(config: AppConfig): string {
  const usable = configuredIds(config)
    .map((id) => entryFor(config, id))
    .filter((model) => model.available);
  const floor = usable.find((model) => model.offline);
  const best = usable.reduce<ModelRecord | null>(
    (winner, model) => (winner && rankFor(winner.id) >= rankFor(model.id) ? winner : model),
    null,
  );
  // The offline desk model is always available, so `usable` is never empty.
  return (best ?? floor)!.id;
}

/** Every model on offer, its pace, and which one the desk is currently using. */
export function modelCatalog(config: AppConfig): ModelCatalogRecord {
  return {
    models: configuredIds(config).map((id) => entryFor(config, id)),
    current: bestModelId(config),
  };
}
