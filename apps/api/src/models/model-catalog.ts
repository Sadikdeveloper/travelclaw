import type { ModelCatalogRecord, ModelLimits, ModelRecord } from '@travelclaw/shared';
import type { AppConfig } from '../config';

/** Every turn limit on this desk is measured over this window. */
export const TURN_WINDOW_MS = 10 * 60 * 1000;

/** The desk's own renderer: deterministic, offline, and the one model always offered. */
export const DESK_MODEL_ID = 'travelclaw-local';

/**
 * The models this desk can run, and the pace on each.
 *
 * Turns per ten minutes is the whole policy, and it is per model on purpose: a bigger model
 * costs more to run, so it is rationed tighter, and using up one model's pace does not take
 * another model away. A guest gets a taste of each; a signed-in account gets several times
 * more. Adding a model is one entry here plus its name in TRAVELCLAW_MODELS.
 */
const KNOWN_MODELS: { id: string; label: string; limits: ModelLimits }[] = [
  {
    id: DESK_MODEL_ID,
    label: 'Desk model',
    // Runs in this process: no provider call, no key, no per-turn cost.
    limits: { guest: 15, account: 60 },
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    limits: { guest: 5, account: 30 },
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'o4-mini',
    label: 'o4-mini',
    limits: { guest: 2, account: 15 },
  },
];

/** A configured model we have no entry for is served, but paced conservatively. */
const UNKNOWN_LIMITS: ModelLimits = { guest: 3, account: 20 };

export function limitsFor(id: string): ModelLimits {
  return KNOWN_MODELS.find((model) => model.id === id)?.limits ?? UNKNOWN_LIMITS;
}

export function labelFor(id: string): string {
  return KNOWN_MODELS.find((model) => model.id === id)?.label ?? id;
}

/**
 * The models configured here, in the order a picker should offer them: the desk's chosen
 * model first, then any other configured ones, then the offline desk model as the last
 * resort. A live model is only `available` when a provider key is configured; it is still
 * listed when it is not, so the control UI can show what a key would unlock.
 */
export function modelCatalog(config: AppConfig): ModelCatalogRecord {
  const configured = [config.modelName, ...config.modelNames].filter(
    (id, index, all) => all.indexOf(id) === index,
  );
  const ids = [...configured];
  if (!ids.includes(DESK_MODEL_ID)) ids.push(DESK_MODEL_ID);

  const models: ModelRecord[] = ids.map((id) => {
    const offline = id === DESK_MODEL_ID;
    return {
      id,
      label: labelFor(id),
      provider: offline ? 'mock' : 'openai',
      limits: limitsFor(id),
      offline,
      available: offline || config.modelApiKey !== '',
    };
  });

  const chosen = models.find((model) => model.id === config.modelName && model.available);
  return {
    models,
    current: chosen?.id ?? models.find((model) => model.offline)!.id,
  };
}
