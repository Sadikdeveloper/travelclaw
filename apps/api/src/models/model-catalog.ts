import type {
  ModelCatalogRecord,
  ModelLimits,
  ModelRecord,
  ModelProviderType,
} from '@travelclaw/shared';
import type { AppConfig } from '../config';

/** Every turn limit on this desk is measured over this window. */
export const TURN_WINDOW_MS = 10 * 60 * 1000;

/** The desk's own renderer: deterministic, offline, and the one model always offered. */
export const DESK_MODEL_ID = 'travelclaw-local';

export interface KnownModelDef {
  id: string;
  label: string;
  provider: ModelProviderType;
  tier: 'fast' | 'strong';
  rank: number;
  limits: ModelLimits | null;
}

/**
 * The models this desk can run, best first.
 *
 * `rank` is which model the desk reaches for when it is free to choose, and `limits` is what
 * that model costs a traveler to use — `null` for a model with no bill behind it, which today
 * is the desk's own. Both are policy, and both belong to the model: a bigger, costlier model
 * is rationed tighter than a small one, an account's allowance is several times a guest's,
 * and a model that costs nothing per turn is not paced at all. Adding a model is one entry
 * here plus its name in TRAVELCLAW_MODELS.
 */
export const KNOWN_MODELS: KnownModelDef[] = [
  // OpenAI models
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    provider: 'openai',
    tier: 'strong',
    rank: 30,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'o4-mini',
    label: 'o4-mini',
    provider: 'openai',
    tier: 'strong',
    rank: 20,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'openai',
    tier: 'fast',
    rank: 10,
    limits: { guest: 5, account: 30 },
  },

  // Google Gemini models (OpenAI-compatible endpoint).
  // Current generation first: a Gemini API key created now gets a 404 for the 2.5 ids
  // ("no longer available to new users"), so the desk never prefers one over a 3.x model
  // a deployment also configured. See `isLegacyGeminiModel`.
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (preview)',
    provider: 'google',
    tier: 'strong',
    rank: 33,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    provider: 'google',
    tier: 'fast',
    rank: 16,
    limits: { guest: 5, account: 30 },
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    provider: 'google',
    tier: 'fast',
    rank: 14,
    limits: { guest: 5, account: 30 },
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    provider: 'google',
    tier: 'fast',
    rank: 11,
    limits: { guest: 5, account: 30 },
  },
  // Legacy ids. An older key still answers on these, so they keep a label and a pace;
  // they just never win against a model of the current generation.
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro (legacy)',
    provider: 'google',
    tier: 'strong',
    rank: 6,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash (legacy)',
    provider: 'google',
    tier: 'fast',
    rank: 5,
    limits: { guest: 5, account: 30 },
  },

  // xAI Grok models (OpenAI-compatible endpoint)
  {
    id: 'grok-2',
    label: 'Grok 2',
    provider: 'xai',
    tier: 'strong',
    rank: 28,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'grok-beta',
    label: 'Grok Beta',
    provider: 'xai',
    tier: 'fast',
    rank: 9,
    limits: { guest: 5, account: 30 },
  },

  // DeepSeek models (OpenAI-compatible endpoint)
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner',
    provider: 'deepseek',
    tier: 'strong',
    rank: 35,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    provider: 'deepseek',
    tier: 'fast',
    rank: 22,
    limits: { guest: 5, account: 30 },
  },

  // Moonshot Kimi models (OpenAI-compatible endpoint)
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    provider: 'kimi',
    tier: 'strong',
    rank: 29,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'moonshot-v1-32k',
    label: 'Moonshot v1 32k',
    provider: 'kimi',
    tier: 'fast',
    rank: 18,
    limits: { guest: 5, account: 30 },
  },

  // CodeCraft (OpenAI-compatible aggregator). One key reaches model families this desk has
  // no connector of its own for: Anthropic's Claude, Alibaba's Qwen, Zhipu's GLM. Ids in a
  // family that already has a connector keep that connector's entry above, so naming a
  // native key never silently reroutes a model through an aggregator.
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'codecraft',
    tier: 'strong',
    rank: 40,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'claude-opus-4.8',
    label: 'Claude Opus 4.8',
    provider: 'codecraft',
    tier: 'strong',
    rank: 39,
    limits: { guest: 2, account: 15 },
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    provider: 'codecraft',
    tier: 'strong',
    rank: 32,
    limits: { guest: 3, account: 20 },
  },
  {
    id: 'glm-5.3',
    label: 'GLM-5.3',
    provider: 'codecraft',
    tier: 'strong',
    rank: 27,
    limits: { guest: 3, account: 20 },
  },
  {
    id: 'qwen3.8-max',
    label: 'Qwen3.8 Max',
    provider: 'codecraft',
    tier: 'strong',
    rank: 26,
    limits: { guest: 3, account: 20 },
  },

  // Desk model
  {
    id: DESK_MODEL_ID,
    label: 'Desk model',
    provider: 'mock',
    tier: 'fast',
    rank: 0,
    // Runs in this process: no provider call, no key, no bill. Nothing to ration, so it is
    // not paced — a traveler is stopped by a model's limit, never by the desk itself.
    limits: null,
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

export function modelDefFor(id: string): KnownModelDef | undefined {
  return KNOWN_MODELS.find((model) => model.id === id);
}

/** `null` for a model that is not paced at all. */
export function limitsFor(id: string): ModelLimits | null {
  const known = modelDefFor(id);
  if (known) return known.limits;
  return UNKNOWN_LIMITS;
}

export function labelFor(id: string): string {
  return modelDefFor(id)?.label ?? id;
}

/**
 * Which connector an id belongs to, by name shape. This is a guess, not a statement: the
 * desk states a provider only in a catalog entry above. The families an aggregator is the
 * only way to reach — Anthropic's `claude-*`, Alibaba's `qwen*`, Zhipu's `glm-*`, and the
 * `seed-*`/`muse-*` models — belong to CodeCraft.
 */
export function providerForModelId(id: string): ModelProviderType {
  if (id === DESK_MODEL_ID) return 'mock';
  const known = modelDefFor(id);
  if (known) return known.provider;
  if (id.startsWith('gemini')) return 'google';
  if (id.startsWith('grok')) return 'xai';
  if (id.startsWith('deepseek')) return 'deepseek';
  if (id.startsWith('kimi') || id.startsWith('moonshot')) return 'kimi';
  if (/^(?:claude|qwen|glm|seed|muse)/.test(id)) return 'codecraft';
  return 'openai';
}

/**
 * The base URL and key a provider runs on here; `apiKey` is empty when this deployment has
 * no key for it.
 *
 * The generic slot (`TRAVELCLAW_MODEL_BASE_URL` / `TRAVELCLAW_MODEL_API_KEY`) serves the
 * OpenAI-compatible default, and it stands in for CodeCraft when no dedicated key is set —
 * pointing that one slot at an aggregator is a complete configuration, which is the option
 * an operator already has without learning a second set of variables.
 */
export function credentialsFor(
  config: AppConfig,
  provider: ModelProviderType,
): { baseUrl: string; apiKey: string } {
  switch (provider) {
    case 'google':
      return {
        baseUrl: config.googleBaseUrl,
        apiKey: config.googleApiKey || config.modelApiKey,
      };
    case 'xai':
      return { baseUrl: config.xaiBaseUrl, apiKey: config.xaiApiKey || config.modelApiKey };
    case 'deepseek':
      return {
        baseUrl: config.deepseekBaseUrl,
        apiKey: config.deepseekApiKey || config.modelApiKey,
      };
    case 'kimi':
      return {
        baseUrl: config.kimiBaseUrl,
        apiKey: config.kimiApiKey || config.modelApiKey,
      };
    case 'codecraft':
      return config.codecraftApiKey
        ? { baseUrl: config.codecraftBaseUrl, apiKey: config.codecraftApiKey }
        : { baseUrl: config.modelBaseUrl, apiKey: config.modelApiKey };
    case 'mock':
      return { baseUrl: '', apiKey: '' };
    case 'openai':
    default:
      return { baseUrl: config.modelBaseUrl, apiKey: config.modelApiKey };
  }
}

function hasProviderKey(config: AppConfig, provider: ModelProviderType): boolean {
  return Boolean(credentialsFor(config, provider).apiKey);
}

/**
 * The provider a configured model id actually runs on.
 *
 * A catalog entry decides outright. Otherwise the name shape is only a guess, so a family
 * whose own connector has no key here is served through an aggregator when one is
 * configured: one CodeCraft key reaches the Gemini, Grok, Kimi, and DeepSeek families too.
 * With no aggregator key, the guess stands and the generic OpenAI-compatible slot serves it,
 * exactly as before this existed.
 */
export function resolveProvider(config: AppConfig, id: string): ModelProviderType {
  if (id === DESK_MODEL_ID) return 'mock';
  const known = modelDefFor(id);
  if (known) return known.provider;
  const guessed = providerForModelId(id);
  if (guessed === 'codecraft') {
    // A claude/qwen/glm id the catalog has never heard of still runs on the aggregator
    // when there is one; without a key it falls to the generic slot like any unknown id.
    return hasProviderKey(config, 'codecraft') ? 'codecraft' : 'openai';
  }
  if (hasProviderKey(config, guessed)) return guessed;
  if (config.modelProvider === 'codecraft' && hasProviderKey(config, 'codecraft')) {
    return 'codecraft';
  }
  return 'openai';
}

export function tierForModelId(id: string): 'fast' | 'strong' {
  return modelDefFor(id)?.tier ?? 'strong';
}

/**
 * Gemini 1.x/2.x ids. Google still serves some of them to older keys, but a key created
 * after the Gemini 3 rollout answers `404` — "no longer available to new users" — so naming
 * one is worth a boot-time warning rather than a silent fallback to the desk renderer.
 */
export function isLegacyGeminiModel(id: string): boolean {
  return /^gemini-[12](?:$|[.-])/.test(id);
}

function rankFor(id: string): number {
  return modelDefFor(id)?.rank ?? UNKNOWN_RANK;
}

export function isModelAvailable(config: AppConfig, id: string): boolean {
  if (id === DESK_MODEL_ID) return true;
  return hasProviderKey(config, resolveProvider(config, id));
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
  // The provider a turn would actually use, so the catalog cannot advertise one connector
  // and run on another.
  const provider = resolveProvider(config, id);
  return {
    id,
    label: labelFor(id),
    provider,
    tier: tierForModelId(id),
    limits: limitsFor(id),
    offline,
    available: isModelAvailable(config, id),
  };
}

/**
 * The model a turn runs on: the strongest available one this deployment actually has.
 * Optionally filter by tier ('fast' | 'strong').
 *
 * Nobody picks a model — not a guest, not a signed-in account, and not the request. Using up
 * one model's pace never moves a traveler onto another model; it only stops them, with a
 * message saying which model ran out.
 */
export function bestModelId(config: AppConfig, tierPreference?: 'fast' | 'strong'): string {
  const usable = configuredIds(config)
    .map((id) => entryFor(config, id))
    .filter((model) => model.available);
  const floor = usable.find((model) => model.offline);

  if (tierPreference) {
    const tierCandidates = usable.filter(
      (model) => !model.offline && model.tier === tierPreference,
    );
    if (tierCandidates.length > 0) {
      const bestTier = tierCandidates.reduce<ModelRecord | null>(
        (winner, model) =>
          winner && rankFor(winner.id) >= rankFor(model.id) ? winner : model,
        null,
      );
      if (bestTier) return bestTier.id;
    }
  }

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
