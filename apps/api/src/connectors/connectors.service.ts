import { Injectable, Logger } from '@nestjs/common';
import type { ToolConnectors } from '@travelclaw/agent-core';
import { loadConfig } from '../config';

/**
 * The only connectors the desk knows. A connector is an operator-held provider
 * key (plus a base URL where relevant) that built-in tools resolve by name
 * when they call out. It carries no code, no tool definition, and no prompt
 * text — and the traveler never provides one: provider access is the desk's
 * job, and anything the desk needs from the traveler arrives as a turn, not a
 * setting.
 */
const SLOTS = {
  currency: {
    baseUrl: (config: ReturnType<typeof loadConfig>) => config.currencyBaseUrl,
    apiKey: (config: ReturnType<typeof loadConfig>) => config.currencyApiKey,
  },
  weather: {
    baseUrl: (config: ReturnType<typeof loadConfig>) => config.weatherBaseUrl,
    apiKey: (config: ReturnType<typeof loadConfig>) => config.weatherApiKey,
  },
} as const;

type SlotName = keyof typeof SLOTS;

function isSlot(name: string): name is SlotName {
  return name === 'currency' || name === 'weather';
}

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  /** The operator's credentials for a slot, or nothing when unset. */
  credentialsFor(name: string): { baseUrl?: string; apiKey?: string } | undefined {
    if (!isSlot(name)) return undefined;
    const config = loadConfig();
    const baseUrl = SLOTS[name].baseUrl(config);
    const apiKey = SLOTS[name].apiKey(config);
    if (!baseUrl && !apiKey) return undefined;
    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
    };
  }

  /** The resolver a turn runs with. Tools read credentials; they never log them. */
  resolverFor(): ToolConnectors {
    return {
      get: (name: string) => this.credentialsFor(name),
      rejected: (name: string) =>
        this.logger.warn(
          `Connector ${name} was rejected by its provider; check the operator key.`,
        ),
    };
  }
}
