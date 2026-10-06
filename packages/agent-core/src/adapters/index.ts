import type { DeskKind } from '../desks';
import { flightapiAdapter } from './flightapi';
import { serpapiAdapter } from './serpapi';
import { travelclawAdapter } from './travelclaw';
import type { ProviderAdapter, ProviderAdapterId } from './types';

/**
 * The built-in adapters, in the order a UI or a doc should list them: the
 * normalized operator contract first, then the vendors TravelClaw speaks to
 * directly. Adding a vendor means adding one file here plus its entry in
 * `PROVIDER_ADAPTERS`; nothing else in the desk changes.
 */
export const PROVIDER_ADAPTERS: Record<ProviderAdapterId, ProviderAdapter> = {
  travelclaw: travelclawAdapter,
  serpapi: serpapiAdapter,
  flightapi: flightapiAdapter,
};

export const PROVIDER_ADAPTER_IDS = Object.keys(PROVIDER_ADAPTERS) as ProviderAdapterId[];

export function isProviderAdapterId(value: string | undefined): value is ProviderAdapterId {
  return value !== undefined && Object.hasOwn(PROVIDER_ADAPTERS, value);
}

/**
 * The adapter a source speaks, or undefined when an operator entry names one this
 * build does not have. Callers decide what an unknown id means; config parsing
 * refuses it at startup so a turn never has to guess.
 */
export function adapterFor(id: string | undefined): ProviderAdapter | undefined {
  if (id === undefined) return travelclawAdapter;
  return isProviderAdapterId(id) ? PROVIDER_ADAPTERS[id] : undefined;
}

export function adapterServes(id: ProviderAdapterId, slot: DeskKind): boolean {
  return PROVIDER_ADAPTERS[id].slots.includes(slot);
}

export { flightapiAdapter, serpapiAdapter, travelclawAdapter };
export type {
  AdapterFailureReason,
  AdapterOfferCandidate,
  AdapterOutcome,
  FlightQueryInput,
  ProviderAdapter,
  ProviderAdapterId,
  StayQueryInput,
} from './types';
