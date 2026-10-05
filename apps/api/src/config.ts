import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';
import { GATEWAY_VERSION } from '@travelclaw/shared';

export interface SearchProviderConfig {
  /** Stable operator-assigned id; saved offers use it to return holds to this source. */
  id: string;
  /** Friendly source label. A provider response can supply a more specific label. */
  name?: string;
  baseUrl: string;
  apiKey: string;
}

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  workspacePath: string;
  /**
   * Kept for compatibility with existing installs. It selects the default model
   * when `TRAVELCLAW_MODEL_NAME` is omitted; the configured model id selects the
   * provider for every actual request.
   */
  modelProvider: 'mock' | 'openai' | 'google' | 'xai' | 'deepseek' | 'kimi';
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  /** Other models the desk offers, from TRAVELCLAW_MODELS. The chosen one is always first. */
  modelNames: string[];
  /** Google Gemini API key and optional base URL (OpenAI-compatible endpoint). */
  googleApiKey: string | null;
  googleBaseUrl: string;
  /** xAI Grok API key and optional base URL (OpenAI-compatible endpoint). */
  xaiApiKey: string | null;
  xaiBaseUrl: string;
  /** DeepSeek API key and optional base URL (OpenAI-compatible endpoint). */
  deepseekApiKey: string | null;
  deepseekBaseUrl: string;
  /** Moonshot Kimi API key and optional base URL (OpenAI-compatible endpoint). */
  kimiApiKey: string | null;
  kimiBaseUrl: string;
  network: boolean;
  browserWorkerUrl: string | null;
  browserWorkerToken: string | null;
  seed: boolean;
  taskDelayMs: number;
  version: string;
  googleClientId: string | null;
  cookieSecure: boolean;
  cookieName: string;
  /** Extra origins allowed to call the gateway. Empty means same-origin only. */
  allowedOrigins: string[];
  sessionTtlDays: number;
  /**
   * Device token that non-loopback HTTP and WebSocket clients must present.
   * When unset, the gateway refuses any non-loopback call — the safe default while
   * binding 0.0.0.0 in dev/Docker. The raw token is kept in memory only; only its
   * hash is ever compared against requests.
   */
  deviceTokenHash: string | null;
  /**
   * Proxy mode requires an explicit trusted proxy IP/CIDR list. Forwarded client
   * identity is for pacing only; a proxy connection never gets a pairing exemption.
   */
  trustProxy: boolean;
  trustedProxies: string[];
  /** Operator-held provider keys that built-in tools resolve by connector name. */
  currencyBaseUrl: string | null;
  currencyApiKey: string | null;
  weatherBaseUrl: string | null;
  weatherApiKey: string | null;
  /** `null` means use the legacy single-provider env; an empty array disables search. */
  flightProviders: SearchProviderConfig[] | null;
  stayProviders: SearchProviderConfig[] | null;
  /**
   * Optional single-install market passed to adapters only for keys the traveler's
   * own message left unstated; never inferred from the route.
   */
  searchBookerCountry: string | null;
  searchCurrency: string | null;
  searchLanguage: string | null;
  /** Legacy single-provider settings, kept as a compatible fallback. */
  flightBaseUrl: string | null;
  flightApiKey: string | null;
  stayBaseUrl: string | null;
  stayApiKey: string | null;
}

export function loadEnvFiles(cwd = process.cwd()): void {
  for (const file of [resolve(cwd, '.env'), resolve(cwd, '../../.env')]) {
    if (!existsSync(file)) continue;
    // Resolve duplicate keys inside one file before touching process.env. This
    // makes an intentional later override (for example replacing the mock model
    // example with Gemini) work, while environment variables supplied by the
    // process and the more-specific first .env file still win.
    const entries = new Map<string, string>();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      entries.set(key, value);
    }
    for (const [key, value] of entries) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AppConfig {
  const provider = configuredModelProvider(env.TRAVELCLAW_MODEL_PROVIDER);
  const googleApiKey =
    env.TRAVELCLAW_GOOGLE_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || null;
  return {
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || 3000),
    databasePath: resolve(cwd, env.DATABASE_PATH || '../../data/travelclaw.db'),
    workspacePath: resolve(cwd, env.WORKSPACE_PATH || '../../workspace'),
    modelProvider: provider,
    modelBaseUrl: (env.TRAVELCLAW_MODEL_BASE_URL || 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    ),
    modelApiKey: env.TRAVELCLAW_MODEL_API_KEY || '',
    modelName: modelNameFrom(env.TRAVELCLAW_MODEL_NAME, provider, googleApiKey),
    modelNames: (env.TRAVELCLAW_MODELS || '')
      .split(',')
      .map(normalizeModelName)
      .filter(Boolean),
    googleApiKey,
    // Gemini's OpenAI-compatible endpoint requires the `/openai` segment. Accept
    // either its full endpoint or the common API-root form to avoid a silent 404.
    googleBaseUrl: googleOpenAiBaseUrl(
      env.TRAVELCLAW_GOOGLE_BASE_URL ||
        env.GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai',
    ),
    xaiApiKey: env.TRAVELCLAW_XAI_API_KEY?.trim() || env.XAI_API_KEY?.trim() || null,
    xaiBaseUrl: (
      env.TRAVELCLAW_XAI_BASE_URL ||
      env.XAI_BASE_URL ||
      'https://api.x.ai/v1'
    ).replace(/\/$/, ''),
    deepseekApiKey:
      env.TRAVELCLAW_DEEPSEEK_API_KEY?.trim() || env.DEEPSEEK_API_KEY?.trim() || null,
    deepseekBaseUrl: (
      env.TRAVELCLAW_DEEPSEEK_BASE_URL ||
      env.DEEPSEEK_BASE_URL ||
      'https://api.deepseek.com/v1'
    ).replace(/\/$/, ''),
    kimiApiKey:
      env.TRAVELCLAW_KIMI_API_KEY?.trim() ||
      env.MOONSHOT_API_KEY?.trim() ||
      env.KIMI_API_KEY?.trim() ||
      null,
    kimiBaseUrl: (
      env.TRAVELCLAW_KIMI_BASE_URL ||
      env.MOONSHOT_BASE_URL ||
      env.KIMI_BASE_URL ||
      'https://api.moonshot.ai/v1'
    ).replace(/\/$/, ''),
    network: env.TRAVELCLAW_NETWORK !== '0',
    ...browserConfig(env),
    seed: env.TRAVELCLAW_SEED !== '0',
    taskDelayMs:
      env.TRAVELCLAW_TASK_DELAY === '0' ? 0 : Number(env.TRAVELCLAW_TASK_DELAY || 1100),
    version: GATEWAY_VERSION,
    googleClientId: env.TRAVELCLAW_GOOGLE_CLIENT_ID?.trim() || null,
    cookieSecure: env.TRAVELCLAW_COOKIE_SECURE === '1',
    cookieName: 'travelclaw_session',
    allowedOrigins: (env.TRAVELCLAW_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    sessionTtlDays: Number(env.TRAVELCLAW_SESSION_TTL_DAYS || 30),
    deviceTokenHash: env.TRAVELCLAW_DEVICE_TOKEN?.trim()
      ? createHash('sha256').update(env.TRAVELCLAW_DEVICE_TOKEN.trim()).digest('hex')
      : null,
    trustProxy: env.TRAVELCLAW_TRUST_PROXY === '1',
    trustedProxies: parseTrustedProxies(env),
    currencyBaseUrl: env.TRAVELCLAW_CURRENCY_BASE_URL?.trim() || null,
    currencyApiKey: env.TRAVELCLAW_CURRENCY_API_KEY?.trim() || null,
    weatherBaseUrl: env.TRAVELCLAW_WEATHER_BASE_URL?.trim() || null,
    weatherApiKey: env.TRAVELCLAW_WEATHER_API_KEY?.trim() || null,
    flightProviders: parseSearchProviders(
      env.TRAVELCLAW_FLIGHT_PROVIDERS_JSON,
      'TRAVELCLAW_FLIGHT_PROVIDERS_JSON',
    ),
    stayProviders: parseSearchProviders(
      env.TRAVELCLAW_STAY_PROVIDERS_JSON,
      'TRAVELCLAW_STAY_PROVIDERS_JSON',
    ),
    searchBookerCountry: normalizeCode(
      env.TRAVELCLAW_BOOKER_COUNTRY,
      /^[A-Za-z]{2}$/,
      'TRAVELCLAW_BOOKER_COUNTRY',
    ),
    searchCurrency: normalizeCode(
      env.TRAVELCLAW_SEARCH_CURRENCY,
      /^[A-Za-z]{3}$/,
      'TRAVELCLAW_SEARCH_CURRENCY',
    ),
    searchLanguage: normalizeCode(
      env.TRAVELCLAW_SEARCH_LANGUAGE,
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
      'TRAVELCLAW_SEARCH_LANGUAGE',
    ),
    flightBaseUrl: env.TRAVELCLAW_FLIGHT_BASE_URL?.trim() || null,
    flightApiKey: env.TRAVELCLAW_FLIGHT_API_KEY?.trim() || null,
    stayBaseUrl: env.TRAVELCLAW_STAY_BASE_URL?.trim() || null,
    stayApiKey: env.TRAVELCLAW_STAY_API_KEY?.trim() || null,
  };
}

const LIVE_MODEL_PROVIDERS = ['openai', 'google', 'xai', 'deepseek', 'kimi'] as const;
type ConfigModelProvider = AppConfig['modelProvider'];

function configuredModelProvider(value: string | undefined): ConfigModelProvider {
  const requested = value?.trim().toLowerCase();
  return LIVE_MODEL_PROVIDERS.includes(requested as (typeof LIVE_MODEL_PROVIDERS)[number])
    ? (requested as ConfigModelProvider)
    : 'mock';
}

/**
 * A couple of human-friendly Gemini aliases are common in copied setup guides.
 * The API needs the canonical id; normalizing it here means `gemini-flash` does
 * not become a request for a model Google cannot find.
 */
function normalizeModelName(value: string): string {
  const name = value.trim();
  const normalized = name.toLowerCase().replace(/[ _]+/g, '-');
  if (normalized === 'gemini-flash' || normalized === 'gemini-flash-latest') {
    return 'gemini-2.5-flash';
  }
  if (normalized === 'gemini-pro' || normalized === 'gemini-pro-latest') {
    return 'gemini-2.5-pro';
  }
  return name;
}

function modelNameFrom(
  raw: string | undefined,
  provider: ConfigModelProvider,
  googleApiKey: string | null,
): string {
  if (raw?.trim()) return normalizeModelName(raw);
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'google':
      return 'gemini-2.5-flash';
    case 'xai':
      return 'grok-beta';
    case 'deepseek':
      return 'deepseek-chat';
    case 'kimi':
      return 'moonshot-v1-32k';
    case 'mock':
      // A bare Gemini key is a complete local configuration: use Flash rather
      // than making an operator also discover a second model-id setting.
      return googleApiKey ? 'gemini-2.5-flash' : 'travelclaw-local';
  }
}

/** Exported for a narrow config test and for operator tooling. */
export function googleOpenAiBaseUrl(raw: string): string {
  const base = raw.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) return base.replace(/\/chat\/completions$/i, '');
  return /\/v1(?:beta)?$/i.test(base) ? `${base}/openai` : base;
}

const MAX_SEARCH_PROVIDERS_PER_KIND = 8;

function normalizeCode(
  raw: string | undefined,
  pattern: RegExp,
  envName: string,
): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!pattern.test(value)) throw new Error(`${envName} has an invalid code format.`);
  return envName === 'TRAVELCLAW_SEARCH_LANGUAGE' ? value : value.toUpperCase();
}

/** Parse operator-only provider config without ever echoing credential values on error. */
function parseSearchProviders(
  raw: string | undefined,
  envName: string,
): SearchProviderConfig[] | null {
  if (raw === undefined || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${envName} must be a JSON array of provider definitions.`);
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_SEARCH_PROVIDERS_PER_KIND) {
    throw new Error(
      `${envName} must contain no more than ${MAX_SEARCH_PROVIDERS_PER_KIND} providers.`,
    );
  }

  const ids = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${envName}[${index}] must be an object.`);
    }
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const name = typeof value.name === 'string' ? value.name.trim() : undefined;
    const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : '';
    const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
      throw new Error(`${envName}[${index}].id must be a short alphanumeric identifier.`);
    }
    if (ids.has(id)) throw new Error(`${envName} contains a duplicate provider id.`);
    if (name !== undefined && (!name || name.length > 80)) {
      throw new Error(`${envName}[${index}].name must be 1 to 80 characters.`);
    }
    if (!baseUrl || baseUrl.length > 2048 || !apiKey || apiKey.length > 4096) {
      throw new Error(`${envName}[${index}] needs a baseUrl and apiKey.`);
    }
    ids.add(id);
    return { id, ...(name ? { name } : {}), baseUrl, apiKey };
  });
}

/** Fail startup closed instead of trusting arbitrary caller-supplied forwarding headers. */
function parseTrustedProxies(env: NodeJS.ProcessEnv): string[] {
  if (env.TRAVELCLAW_TRUST_PROXY !== '1') return [];
  const entries = (env.TRAVELCLAW_TRUSTED_PROXIES || '').split(',').map((s) => s.trim());
  const error = () =>
    new Error(
      'TRAVELCLAW_TRUST_PROXY=1 requires TRAVELCLAW_TRUSTED_PROXIES with explicit proxy IPs/CIDRs (no /0 or aliases).',
    );
  if (!entries.length || entries.length > 32) throw error();
  for (const entry of entries) {
    const [ip, prefix, ...extra] = entry.split('/');
    const family = isIP(ip || '');
    if (
      !family ||
      extra.length ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) ||
          Number(prefix) < 1 ||
          Number(prefix) > (family === 4 ? 32 : 128)))
    ) {
      throw error();
    }
  }
  try {
    for (const entry of entries) {
      const trusts = proxyaddr.compile([entry]);
      // IPv4-mapped IPv6 /96 can otherwise disguise an effective IPv4 /0.
      if (trusts('0.0.0.0', 0) && trusts('255.255.255.255', 0)) throw error();
    }
  } catch {
    throw error();
  }
  return entries;
}

function browserConfig(
  env: NodeJS.ProcessEnv,
): Pick<AppConfig, 'browserWorkerUrl' | 'browserWorkerToken'> {
  const raw = env.TRAVELCLAW_BROWSER_WORKER_URL?.trim();
  const token = env.TRAVELCLAW_BROWSER_WORKER_TOKEN?.trim();
  if (!raw && !token) return { browserWorkerUrl: null, browserWorkerToken: null };
  try {
    const url = new URL(raw || '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !token ||
      token.length < 32
    )
      throw new Error();
    return { browserWorkerUrl: url.origin, browserWorkerToken: token };
  } catch {
    throw new Error(
      'Browser worker requires an HTTP(S) origin and a token of at least 32 characters.',
    );
  }
}
