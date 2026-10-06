import type { DeskKind } from '../desks';
import type { ConnectorCredentials, SearchMarket, ToolContext } from '../types';

/**
 * Vendor adapters sit between the desk's own search query and a provider's real
 * API. The desk speaks one query shape and stores one offer shape; an adapter's
 * only job is to translate, never to invent a number, a route, or a hold.
 *
 * Three rules hold for every adapter:
 *
 * 1. An offer exists only when the vendor priced it. An entry the adapter cannot
 *    read a price and an id from is counted as dropped, not filled in.
 * 2. A vendor key never appears in a returned string. An adapter that must put a
 *    key somewhere unusual (a vendor that takes it in a URL path) still reports
 *    only scrubbed detail, so nothing downstream can log or show the secret.
 * 3. Resolution is real data. When a vendor needs an airport code the desk does
 *    not have, the adapter either resolves it with the vendor's own lookup or
 *    refuses the search; it never guesses a code from a city name.
 */

/** Built-in adapters. `travelclaw` is the normalized operator-hosted contract. */
export type ProviderAdapterId = 'travelclaw' | 'serpapi' | 'flightapi';

/** New reasons a source can refuse a search that the original contract lacked. */
export type AdapterFailureReason = 'bad_query' | 'unsupported';

export interface FlightQueryInput {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  travelers: number;
}

export interface StayQueryInput {
  destination: string;
  checkIn: string;
  checkOut: string;
  travelers: number;
}

/**
 * One offer as a vendor described it, already mapped into the desk's field
 * names but not yet trusted. `providers.ts` revalidates every candidate with the
 * same schema the operator-hosted contract uses, so an adapter cannot widen what
 * the desk is willing to show or hold.
 */
export interface AdapterOfferCandidate {
  /** The vendor's own identifier for this offer. Required. */
  id: string;
  /** The vendor's own price and the currency it priced in. Required, and nested
   * exactly as the operator-hosted contract sends it, so one validator covers
   * every adapter. */
  price: { amount: number; currency: string };
  title?: string;
  detail?: string;
  segments?: Array<{
    from: string;
    to: string;
    departAt?: string | null;
    arriveAt?: string | null;
    carrier?: string | null;
  }>;
  stay?: {
    name: string;
    roomType?: string | null;
    nights?: number | null;
    checkIn?: string | null;
    checkOut?: string | null;
    rating?: number | null;
  } | null;
  /** The vendor's own stop count, when its payload counts them itself. */
  stops?: number | null;
  /** Minutes the vendor reported for the whole itinerary. */
  durationMinutes?: number | null;
  /** Places where the traveler changes planes, only when the vendor named them. */
  stopNames?: string[] | null;
  hold?: unknown;
}

export type AdapterOutcome =
  | {
      ok: true;
      /** The vendor's name for itself, when its payload says one. */
      provider?: string;
      /**
       * Candidates in the desk's field names. Untyped on purpose: the desk
       * revalidates each one, so an adapter's own confidence proves nothing.
       */
      offers: unknown[];
      /** Results the adapter read but refused to map (no price, no id). */
      dropped?: number;
    }
  | {
      ok: false;
      reason:
        | 'no_key'
        | 'no_base_url'
        | 'bad_query'
        | 'unauthorized'
        | 'http_error'
        | 'timeout'
        | 'network_error'
        | 'bad_payload';
      detail: string;
    };

export interface AdapterSearchInput {
  kind: DeskKind;
  query: FlightQueryInput | StayQueryInput;
  /** What the traveler stated (or the operator defaulted) about point of sale. */
  market: SearchMarket;
}

/** Everything an adapter may read while it calls a vendor. Never logs the key. */
export interface AdapterContext {
  credential: ConnectorCredentials;
  fetchImpl: typeof fetch;
  now: Date;
  /**
   * Shared tool context, for a vendor whose lookup needs the same network gate
   * and the same connector rejection reporting as its search.
   */
  tool: ToolContext;
}

export interface ProviderAdapter {
  id: ProviderAdapterId;
  /** Shown when the operator did not name the source. */
  label: string;
  /** Which searches this adapter can serve. */
  slots: readonly DeskKind[];
  /** `provider` only when the vendor's own API can confirm a hold. */
  hold: 'provider' | 'unsupported';
  /** Filled in by config when an operator entry omits a base URL. */
  defaultBaseUrl: string | null;
  search(input: AdapterSearchInput, ctx: AdapterContext): Promise<AdapterOutcome>;
}
