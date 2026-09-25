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
  network: boolean;
  seed: boolean;
  version: string;
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
    network: env.TRAVELCLAW_NETWORK !== '0',
    seed: env.TRAVELCLAW_SEED !== '0',
    version: GATEWAY_VERSION,
  };
}
