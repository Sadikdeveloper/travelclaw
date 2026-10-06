import { Injectable, Logger } from '@nestjs/common';
import type { ConnectorCredentials, ToolConnectors } from '@travelclaw/agent-core';
import { loadConfig, type SearchProviderConfig } from '../config';

/**
 * The only connectors the desk knows. A connector is an operator-held provider
 * key (plus a base URL where relevant) that built-in tools and the flight and
 * stay desks resolve by name when they call out. It carries no code, no tool
 * definition, and no prompt text — and the traveler never provides one:
 * provider access is the desk's job, and anything the desk needs from the
 * traveler arrives as a turn, not a setting.
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
type SearchSlot = 'flight' | 'stay';

function isSlot(name: string): name is SlotName {
  return Object.hasOwn(SLOTS, name);
}

function isSearchSlot(name: string): name is SearchSlot {
  return name === 'flight' || name === 'stay';
}

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  /** The operator's credentials for a singleton slot, or the first search source. */
  credentialsFor(name: string): ConnectorCredentials | undefined {
    if (isSearchSlot(name)) return this.searchProvidersFor(name)[0];
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

  /** Every operator-configured compatible source for a flight or stay search. */
  searchProvidersFor(name: SearchSlot): ConnectorCredentials[] {
    const config = loadConfig();
    const configured = name === 'flight' ? config.flightProviders : config.stayProviders;
    if (configured !== null) return configured.map(toCredentials);

    // Backward compatibility: the original single-provider env still works as
    // one source, including partial config so the desk can explain the mistake.
    const baseUrl = name === 'flight' ? config.flightBaseUrl : config.stayBaseUrl;
    const apiKey = name === 'flight' ? config.flightApiKey : config.stayApiKey;
    if (!baseUrl && !apiKey) return [];
    return [
      {
        providerId: `${name}-default`,
        adapter: 'travelclaw',
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      },
    ];
  }

  /** The resolver a turn runs with. Tools read credentials; they never log them. */
  resolverFor(): ToolConnectors {
    return {
      get: (name: string) => this.credentialsFor(name),
      all: (name: string) => {
        if (isSearchSlot(name)) return this.searchProvidersFor(name);
        const credentials = this.credentialsFor(name);
        return credentials ? [credentials] : [];
      },
      rejected: (name: string) =>
        this.logger.warn(
          `Connector ${name} was rejected by its provider; check the operator key.`,
        ),
    };
  }
}

function toCredentials(provider: SearchProviderConfig): ConnectorCredentials {
  return {
    providerId: provider.id,
    ...(provider.name ? { providerName: provider.name } : {}),
    adapter: provider.adapter,
    ...(provider.cityCodes ? { cityCodes: provider.cityCodes } : {}),
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
  };
}
