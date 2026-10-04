import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
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
  modelProvider: 'mock' | 'openai';
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  /** Other models the desk offers, from TRAVELCLAW_MODELS. The chosen one is always first. */
  modelNames: string[];
  network: boolean;
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
   * Trust X-Forwarded-For when set to '1' (so a reverse proxy can identify the
   * real client). Test suites set this so supertest can simulate remote peers.
   */
  trustProxy: boolean;
  /** Operator-held provider keys that built-in tools resolve by connector name. */
  currencyBaseUrl: string | null;
  currencyApiKey: string | null;
  weatherBaseUrl: string | null;
  weatherApiKey: string | null;
  /** `null` means use the legacy single-provider env; an empty array disables search. */
  flightProviders: SearchProviderConfig[] | null;
  stayProviders: SearchProviderConfig[] | null;
  /** Optional single-install pricing/content market; never inferred from the route. */
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
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AppConfig {
  const provider = env.TRAVELCLAW_MODEL_PROVIDER === 'openai' ? 'openai' : 'mock';
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
    modelName:
      env.TRAVELCLAW_MODEL_NAME ||
      (provider === 'openai' ? 'gpt-4o-mini' : 'travelclaw-local'),
    modelNames: (env.TRAVELCLAW_MODELS || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    network: env.TRAVELCLAW_NETWORK !== '0',
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
