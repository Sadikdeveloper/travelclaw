import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GATEWAY_VERSION } from '@travelclaw/shared';

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
  };
}
