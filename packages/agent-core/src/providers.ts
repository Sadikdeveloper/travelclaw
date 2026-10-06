import { z } from 'zod';
import type { OfferFacts } from '@travelclaw/shared';
import { adapterFor, type ProviderAdapterId } from './adapters';
import type { FlightQueryInput, StayQueryInput } from './adapters';
import type { DeskKind } from './desks';
import {
  authHeaders,
  connectorBase,
  FetchTimeoutError,
  fetchWithTimeout,
  NOT_JSON,
  providerHost,
  readJson,
} from './http';
import { addDays, parseIsoDate } from './dates';
import type { ConnectorCredentials, SearchMarket, ToolContext, TripHints } from './types';

/**
 * Flight and stay search behind operator-held provider keys. A search can fan
 * out to several compatible sources so global coverage does not depend on one
 * vendor or market.
 *
 * Three rules shape this file:
 *
 * 1. With no key the desk does nothing it did not do before. A search is only
 *    attempted when the connector slot carries both a base URL and a key, so an
 *    ordinary install keeps writing briefs and never pretends to shop a fare.
 * 2. Nothing here invents a price or an availability. An offer the provider did
 *    not price is dropped, and a payload that does not parse is reported as a
 *    failure rather than rendered into a plausible-looking list.
 * 3. A hold exists only when the provider says one does, with a reference to
 *    point at. Anything weaker is an offer, labelled as an offer.
 *
 * Translation to a vendor's own API lives in `./adapters`. This file keeps the
 * rules: it fans out, validates every candidate an adapter returns, and refuses a
 * hold when the source behind an offer cannot confirm one.
 */

const HOLD_TIMEOUT_MS = 9000;

/** How many offers a desk keeps from one search. The provider's own order is kept. */
export const MAX_OFFERS_PER_SEARCH = 6;

const FLIGHT_SLOT = 'flight';
const STAY_SLOT = 'stay';

export interface FlightQuery extends SearchMarket {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  travelers: number;
}

export interface StayQuery extends SearchMarket {
  destination: string;
  checkIn: string;
  checkOut: string;
  travelers: number;
}

/** One offer exactly as the provider reported it, normalized but never padded. */
export interface ProviderOffer {
  /** Stable operator-assigned connector id, used to route an explicit hold request. */
  providerId: string;
  /** Friendly/provider-supplied source name. */
  provider: string;
  /** Normalized endpoint identity, kept privately so a hold cannot hit a replacement. */
  providerBaseUrl: string;
  /** When this source's answer was read, so a stale price is visibly stale. */
  retrievedAt: string;
  /** The provider's own id, echoed back when the desk asks it for a hold. */
  providerOfferId: string;
  title: string;
  detail: string | null;
  /** Structured vendor facts when the source sent them, else null. */
  facts: OfferFacts | null;
  currency: string;
  totalAmount: number;
  /** `confirmed` only when the provider confirmed one and named a reference. */
  hold: 'none' | 'confirmed';
  holdRef: string | null;
  holdExpiresAt: string | null;
  /** Set when the provider sent hold-shaped details we refused to believe. */
  holdNote: string | null;
  /** Which built-in adapter reached this source. */
  adapter: ProviderAdapterId;
  /**
   * Whether the source behind this offer can confirm a hold at all. A vendor
   * that only quotes prices is `unsupported`, and the desk says so instead of
   * offering a button that would fail.
   */
  holdSupport: 'provider' | 'unsupported';
}

export interface ProviderSearchSource {
  providerId: string;
  provider: string;
  /** Private endpoint identity; never included in the traveler-facing offer type. */
  providerBaseUrl: string;
  /** Which built-in adapter reached this source. */
  adapter: ProviderAdapterId;
  holdSupport: 'provider' | 'unsupported';
  ok: boolean;
  retrievedAt: string | null;
  offerCount: number;
  dropped: number;
  limited: number;
  reason?: ProviderFailureReason;
  detail?: string;
}

export interface ProviderSearchFound {
  ok: true;
  kind: DeskKind;
  /** Successful and failed providers, so partial coverage is explicit. */
  sources: ProviderSearchSource[];
  offers: ProviderOffer[];
  /** Results that did not match any source contract or lacked a usable price/id. */
  dropped: number;
  /** Additional valid offers omitted by source or global result limits. */
  limited: number;
}

export type ProviderFailureReason =
  | 'no_key'
  | 'no_base_url'
  | 'unauthorized'
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'bad_payload'
  /** The source cannot be asked this question — it needs a code the desk lacks. */
  | 'bad_query'
  /** This source has no way to do what was asked, such as confirm a hold. */
  | 'unsupported';

export interface ProviderSearchFailed {
  ok: false;
  kind: DeskKind;
  reason: ProviderFailureReason;
  provider: string | null;
  /** Developer-facing. Never carries the key, never shown to the traveler as-is. */
  detail: string;
}

export type ProviderSearchResult = ProviderSearchFound | ProviderSearchFailed;

export interface ProviderHoldResult {
  confirmed: boolean;
  ref: string | null;
  expiresAt: string | null;
  reason: 'confirmed' | 'refused' | 'provider_changed' | ProviderFailureReason;
  /** One traveler-facing sentence: what the provider did or did not confirm. */
  note: string;
}

/**
 * What a desk needs before it can search. `missing` is empty when `query` is
 * there; the desk asks for those fields as a turn instead of guessing them.
 */
export type QueryDraft<T> =
  { query: T; missing: [] } | { query?: undefined; missing: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A provider's price. A decimal *string* is accepted because that is how money
 * usually arrives over a wire; anything else is refused rather than coerced.
 */
const priceSchema = z.object({
  amount: z
    .union([
      z.number().finite().nonnegative(),
      z
        .string()
        .trim()
        .regex(/^\d{1,12}(\.\d{1,3})?$/, 'a plain decimal amount')
        .transform(Number),
    ])
    .refine((amount) => amount <= 1_000_000_000, 'at most one billion'),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'a three-letter currency code')
    .transform((value) => value.toUpperCase()),
});

const segmentSchema = z.object({
  from: z.string().trim().min(1).max(80),
  to: z.string().trim().min(1).max(80),
  departAt: z.string().trim().min(1).max(64).nullish(),
  arriveAt: z.string().trim().min(1).max(64).nullish(),
  carrier: z.string().trim().min(1).max(80).nullish(),
});

const staySchema = z.object({
  name: z.string().trim().min(1).max(160),
  roomType: z.string().trim().min(1).max(80).nullish(),
  nights: z.number().int().min(1).max(365).nullish(),
  checkIn: z.string().trim().min(1).max(40).nullish(),
  checkOut: z.string().trim().min(1).max(40).nullish(),
  rating: z.number().min(0).max(10).nullish(),
});

/**
 * A hold the desk is willing to report. Deliberately strict: `confirmed: true`
 * plus a reference. A provider that says "held" with nothing to point at has
 * not given the traveler anything to hold it to.
 */
const confirmedHoldSchema = z.object({
  confirmed: z.literal(true),
  ref: z.string().trim().min(1).max(120),
  expiresAt: z.string().trim().min(1).max(64).nullish(),
});

const providerOfferSchema = z.object({
  id: z.string().trim().min(1).max(120),
  price: priceSchema,
  title: z.string().trim().min(1).max(200).nullish(),
  detail: z.string().trim().min(1).max(600).nullish(),
  segments: z.array(segmentSchema).min(1).max(8).nullish(),
  stay: staySchema.nullish(),
  stops: z.number().int().min(0).max(8).nullish(),
  durationMinutes: z.number().int().min(0).max(10_080).nullish(),
  stopNames: z.array(z.string().trim().min(1).max(80)).max(8).nullish(),
  hold: z.unknown().nullish(),
});

export function flightQueryFrom(text: string, hints: TripHints): QueryDraft<FlightQuery> {
  const route = routeFromText(text);
  const origin = cleanCity(hints.origin ?? route?.origin);
  const destination = cleanCity(
    hints.destination ?? route?.destination ?? destinationFromText(text),
  );
  const departDate = validDate(hints.startDate);
  const travelers = validTravelers(hints.travelers);
  const missing: string[] = [];
  if (!origin) missing.push('an origin city');
  if (!destination) missing.push('a destination');
  if (!departDate) missing.push('a departure date');
  if (hints.travelers !== undefined && !travelers) {
    missing.push('a party size from 1 to 12');
  }
  if (
    missing.length ||
    !origin ||
    !destination ||
    !departDate ||
    (hints.travelers !== undefined && !travelers)
  ) {
    return { missing };
  }
  // `extractHints` can derive an end date from "four days" for itinerary tools.
  // For airfare, only a second date the traveler actually wrote is a return leg.
  const returnDate = explicitDates(text)[1];
  return {
    query: {
      origin,
      destination,
      departDate,
      ...(returnDate && validDate(returnDate) && laterDate(returnDate, departDate)
        ? { returnDate }
        : {}),
      travelers: travelers ?? 1,
    },
    missing: [],
  };
}

export function stayQueryFrom(text: string, hints: TripHints): QueryDraft<StayQuery> {
  const destination = cleanCity(hints.destination ?? destinationFromText(text));
  const checkIn = validDate(hints.startDate);
  const writtenDates = explicitDates(text);
  const writtenCheckout = validDate(writtenDates[1]);
  const nights = Number(/\b(\d{1,3})\s*nights?\b/i.exec(text)?.[1] ?? 0);
  const nightCheckout =
    checkIn && nights >= 1 && nights <= 365
      ? (addDays(checkIn, nights) ?? undefined)
      : undefined;
  const checkOut = writtenCheckout ?? nightCheckout;
  const travelers = validTravelers(hints.travelers);
  const missing: string[] = [];
  if (!destination) missing.push('a city');
  if (!checkIn) missing.push('a check-in date');
  if (!checkOut || !checkIn || checkOut <= checkIn) {
    missing.push('a check-out date after check-in');
  }
  if (hints.travelers !== undefined && !travelers) {
    missing.push('a party size from 1 to 12');
  }
  if (
    missing.length ||
    !destination ||
    !checkIn ||
    !checkOut ||
    checkOut <= checkIn ||
    (hints.travelers !== undefined && !travelers)
  ) {
    return { missing };
  }
  return {
    query: {
      destination,
      checkIn,
      checkOut,
      travelers: travelers ?? 1,
    },
    missing: [],
  };
}

export async function searchFlights(
  query: FlightQuery,
  ctx: ToolContext,
): Promise<ProviderSearchResult> {
  return search(FLIGHT_SLOT, query, ctx);
}

export async function searchStays(
  query: StayQuery,
  ctx: ToolContext,
): Promise<ProviderSearchResult> {
  return search(STAY_SLOT, query, ctx);
}

/** Only the market keys the message or the operator default actually supplied. */
function marketOf(query: SearchMarket): SearchMarket {
  return {
    ...(query.bookerCountry ? { bookerCountry: query.bookerCountry } : {}),
    ...(query.currency ? { currency: query.currency } : {}),
    ...(query.language ? { language: query.language } : {}),
  };
}

/**
 * Ask the provider to hold an offer it already returned. The answer is believed
 * only when it confirms one with a reference; every other outcome — including a
 * provider that says "hold requested" — comes back unconfirmed with a sentence
 * the desk can hand the traveler.
 */
export async function requestProviderHold(
  input: {
    kind: DeskKind;
    providerOfferId: string;
    providerId?: string;
    providerName?: string;
    providerBaseUrl?: string;
  },
  ctx: ToolContext,
): Promise<ProviderHoldResult> {
  const slot = input.kind === 'flight' ? FLIGHT_SLOT : STAY_SLOT;
  if (!ctx.network) {
    return refused('no_key', 'Network access is off on this desk, so nothing can be held.');
  }
  const credentials = providerCredentials(slot, ctx);
  if (!credentials.length) {
    return refused(
      input.providerBaseUrl || input.providerId ? 'provider_changed' : 'no_key',
      input.providerBaseUrl || input.providerId
        ? `The provider changed since this offer was retrieved. Re-search before asking for a hold.`
        : `No ${slot} provider key is set, so there is no provider to ask for a hold.`,
    );
  }

  const savedBase = input.providerBaseUrl ? connectorBase(input.providerBaseUrl, '') : '';
  const target = findProviderTarget(credentials, slot, input.providerId, savedBase);
  if (!target) {
    return refused(
      'provider_changed',
      `The provider changed since this offer was retrieved. Re-search before asking for a hold.`,
    );
  }
  // A vendor that only quotes prices has no hold endpoint to call. Sending the
  // offer id anywhere else would be asking a different question than the
  // traveler asked, so the desk says what this source is instead.
  const holdAdapter = adapterFor(target.adapter);
  if (!holdAdapter || holdAdapter.hold !== 'provider') {
    const source = holdAdapter?.label ?? 'this source';
    return refused(
      'unsupported',
      `${source} quotes prices and does not confirm holds, so this stays an offer. Nothing was purchased.`,
    );
  }
  if (!target.apiKey) {
    return refused(
      'no_key',
      `The configured ${slot} provider has no key, so no hold was requested.`,
    );
  }
  if (!target.baseUrl) {
    return refused(
      'no_base_url',
      `The configured ${slot} provider has no usable URL, so no hold was requested.`,
    );
  }
  const provider =
    input.providerName?.trim() || target.providerName || providerHost(target.baseUrl);
  if (!ctx.fetchImpl) {
    return refused('no_key', 'This desk has no way to call out, so nothing can be held.');
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      ctx.fetchImpl,
      `${target.baseUrl}/holds`,
      HOLD_TIMEOUT_MS,
      {
        method: 'POST',
        headers: {
          ...authHeaders(target.apiKey),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ kind: slot, offerId: input.providerOfferId }),
      },
    );
  } catch (error) {
    if (error instanceof FetchTimeoutError) {
      return refused(
        'timeout',
        `${provider} did not answer the hold request in time, so no hold exists. The offer stands as an offer.`,
      );
    }
    return refused(
      'network_error',
      `${provider} could not be reached for the hold request or redirected elsewhere, so no hold exists. The offer stands as an offer.`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    ctx.connectors?.rejected?.(slot);
    return refused(
      'unauthorized',
      `${provider} rejected the operator key, so no hold exists. The offer stands as an offer.`,
    );
  }
  if (!response.ok) {
    return refused(
      'http_error',
      `${provider} answered HTTP ${response.status} to the hold request, so no hold exists. The offer stands as an offer.`,
    );
  }

  const body = await readJson(response);
  if (body === NOT_JSON) {
    return refused(
      'bad_payload',
      `${provider} answered the hold request with something that is not JSON, so no hold exists.`,
    );
  }
  const confirmed = confirmedHoldSchema.safeParse(body);
  if (confirmed.success) {
    return {
      confirmed: true,
      ref: confirmed.data.ref,
      expiresAt: confirmed.data.expiresAt ?? null,
      reason: 'confirmed',
      note: `${provider} confirmed a hold${confirmed.data.expiresAt ? ` until ${confirmed.data.expiresAt}` : ''}. Reference ${confirmed.data.ref}. Nothing was purchased.`,
    };
  }
  // Anything weaker than a confirmation — `confirmed: false`, a "requested" flag,
  // a hold with no reference — is reported as no hold. Guessing here is how a
  // traveler ends up believing a seat is theirs.
  return refused(
    'refused',
    `${provider} did not confirm a hold for that offer, so it is still an offer. Nothing was purchased.`,
  );
}

interface ProviderAttempt {
  source: ProviderSearchSource;
  offers: ProviderOffer[];
}

interface ProviderTarget {
  providerId: string;
  providerName?: string;
  baseUrl: string;
  apiKey?: string;
  adapter?: string;
}

function providerCredentials(slot: DeskKind, ctx: ToolContext) {
  const listed = ctx.connectors?.all?.(slot);
  if (listed) return listed;
  const single = ctx.connectors?.get(slot);
  return single ? [single] : [];
}

function findProviderTarget(
  credentials: ReturnType<typeof providerCredentials>,
  slot: DeskKind,
  providerId: string | undefined,
  savedBase: string,
): ProviderTarget | undefined {
  const targets = credentials.map((credential, index) => ({
    providerId: credential.providerId ?? `${slot}-${index + 1}`,
    providerName: credential.providerName?.trim() || undefined,
    baseUrl: connectorBase(credential.baseUrl, ''),
    apiKey: credential.apiKey,
    adapter: credential.adapter,
  }));
  if (!providerId && !savedBase) return targets[0];

  const exact = targets.find((target) => target.providerId === providerId);
  if (exact && (!savedBase || exact.baseUrl === savedBase)) return exact;

  // Rows written by the original single-provider implementation use the endpoint
  // itself as their identity. Keep those old offers safe and usable after upgrade.
  if (savedBase && providerId === savedBase) {
    return targets.find((target) => target.baseUrl === savedBase);
  }
  // Direct callers that have an endpoint snapshot but predate stable ids still
  // resolve only when exactly one configured source owns that endpoint.
  if (!providerId && savedBase) {
    const matches = targets.filter((target) => target.baseUrl === savedBase);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

async function search(
  slot: DeskKind,
  query: FlightQuery | StayQuery,
  ctx: ToolContext,
): Promise<ProviderSearchResult> {
  const failed = (
    reason: ProviderFailureReason,
    detail: string,
    provider: string | null = null,
  ): ProviderSearchFailed => ({ ok: false, kind: slot, reason, provider, detail });

  if (!ctx.network) {
    return failed('no_key', 'Network access is off on this desk (TRAVELCLAW_NETWORK=0).');
  }
  const credentials = providerCredentials(slot, ctx);
  if (!credentials.length) {
    return failed(
      'no_key',
      `No ${slot} provider sources are configured; the desk wrote its own brief.`,
    );
  }
  if (!ctx.fetchImpl) {
    return failed('no_key', 'This desk has no way to call out.');
  }

  const market = marketOf(query);
  const attempts = await Promise.all(
    credentials.map((credential, index) =>
      searchOneProvider(slot, query, market, credential, index, ctx),
    ),
  );
  const successful = attempts.filter((attempt) => attempt.source.ok);
  if (!successful.length) {
    const firstFailure = attempts[0]?.source;
    const details = attempts
      .map(({ source }) => `${source.provider}: ${source.detail ?? 'search failed'}`)
      .join(' ');
    return failed(
      firstFailure?.reason ?? 'http_error',
      `All configured ${slot} sources failed. ${details}`,
      attempts.length === 1 ? (firstFailure?.provider ?? null) : null,
    );
  }

  // Providers return locally-ranked offers and may use different currencies, so
  // do not pretend there is a universal price sort. Interleave their own ranks so
  // the first configured source cannot crowd every other source out.
  const offers = roundRobin(
    successful.map((attempt) => attempt.offers),
    MAX_OFFERS_PER_SEARCH,
  );
  const sources = attempts.map(({ source }) => source);
  const dropped = sources.reduce((total, source) => total + source.dropped, 0);
  const limited =
    sources.reduce((total, source) => total + source.limited, 0) +
    successful.reduce((total, attempt) => total + attempt.offers.length, 0) -
    offers.length;
  return {
    ok: true,
    kind: slot,
    sources,
    offers,
    dropped,
    limited,
  };
}

async function searchOneProvider(
  slot: DeskKind,
  query: FlightQuery | StayQuery,
  market: SearchMarket,
  credential: ConnectorCredentials,
  index: number,
  ctx: ToolContext,
): Promise<ProviderAttempt> {
  const providerId = credential.providerId ?? `${slot}-${index + 1}`;
  const adapter = adapterFor(credential.adapter);
  const base = connectorBase(credential.baseUrl, adapter?.defaultBaseUrl ?? '');
  const fallbackName =
    credential.providerName?.trim() ||
    (adapter && adapter.id !== 'travelclaw'
      ? adapter.label
      : base
        ? providerHost(base)
        : `${slot} source ${index + 1}`);
  const source: ProviderSearchSource = {
    providerId,
    provider: fallbackName,
    providerBaseUrl: base,
    adapter: adapter?.id ?? 'travelclaw',
    holdSupport: adapter?.hold ?? 'provider',
    ok: false,
    retrievedAt: null,
    offerCount: 0,
    dropped: 0,
    limited: 0,
  };
  const failed = (reason: ProviderFailureReason, detail: string): ProviderAttempt => ({
    source: { ...source, reason, detail },
    offers: [],
  });

  if (!adapter) {
    // Config refuses an unknown adapter at startup; this is the direct-caller path.
    return failed('unsupported', 'names a provider adapter this build does not have.');
  }
  if (!adapter.slots.includes(slot)) {
    return failed(
      'unsupported',
      `is a ${adapter.slots.join(' and ')} source and was asked for a ${slot} search.`,
    );
  }
  if (!credential.apiKey) return failed('no_key', 'no operator key is configured.');
  if (!base) return failed('no_base_url', 'no usable base URL is configured.');

  const outcome = await adapter.search(
    {
      kind: slot,
      query: query as FlightQueryInput | StayQueryInput,
      market,
    },
    { credential, fetchImpl: ctx.fetchImpl!, now: ctx.now, tool: ctx },
  );
  if (!outcome.ok) return failed(outcome.reason, outcome.detail);

  const provider = outcome.provider ?? fallbackName;
  const retrievedAt = ctx.now.toISOString();
  const okSource: ProviderSearchSource = {
    ...source,
    provider,
    ok: true,
    retrievedAt,
    dropped: outcome.dropped ?? 0,
  };
  const offers: ProviderOffer[] = [];
  for (const raw of outcome.offers) {
    const parsed = providerOfferSchema.safeParse(raw);
    if (!parsed.success) {
      // An offer with no price the provider reported is not an offer. Dropping it
      // beats filling the gap with a number nobody said.
      okSource.dropped += 1;
      continue;
    }
    if (offers.length >= MAX_OFFERS_PER_SEARCH) {
      okSource.limited += 1;
      continue;
    }
    offers.push(normalizeOffer(parsed.data, slot, okSource));
  }
  okSource.offerCount = offers.length;
  return { source: okSource, offers };
}

function roundRobin<T>(groups: T[][], limit: number): T[] {
  const results: T[] = [];
  for (let index = 0; results.length < limit; index += 1) {
    let found = false;
    for (const group of groups) {
      const value = group[index];
      if (value === undefined) continue;
      results.push(value);
      found = true;
      if (results.length >= limit) break;
    }
    if (!found) break;
  }
  return results;
}

type ProviderOfferPayload = z.infer<typeof providerOfferSchema>;

function normalizeOffer(
  raw: ProviderOfferPayload,
  kind: DeskKind,
  source: ProviderSearchSource,
): ProviderOffer {
  const hold = readHold(raw.hold);
  const segments = raw.segments ?? [];
  const stay = raw.stay ?? null;
  const title =
    raw.title ??
    (kind === 'flight'
      ? flightTitle(segments, raw.id)
      : (stay?.name ?? `Stay offer ${raw.id}`));
  const detail =
    raw.detail ?? (kind === 'flight' ? flightDetail(segments) : stayDetail(stay)) ?? null;
  return {
    providerId: source.providerId,
    provider: source.provider,
    providerBaseUrl: source.providerBaseUrl,
    retrievedAt: source.retrievedAt!,
    providerOfferId: raw.id,
    title,
    detail,
    facts: offerFacts(raw, kind, segments, stay),
    currency: raw.price.currency,
    totalAmount: raw.price.amount,
    hold: hold.hold,
    holdRef: hold.ref,
    holdExpiresAt: hold.expiresAt,
    holdNote: hold.note,
    adapter: source.adapter,
    holdSupport: source.holdSupport,
  };
}

/**
 * The structured shape of what the vendor sent, or null when it sent nothing
 * structured. A derived stop count is allowed only where the structure proves it:
 * one leg is nonstop, and a leg's own endpoint is where the traveler changes
 * planes. Everything else is the vendor's own number or stays absent.
 */
function offerFacts(
  raw: ProviderOfferPayload,
  kind: DeskKind,
  segments: z.infer<typeof segmentSchema>[],
  stay: z.infer<typeof staySchema> | null,
): OfferFacts | null {
  if (kind === 'stay') {
    if (!stay) return null;
    return {
      kind: 'stay',
      name: stay.name,
      roomType: stay.roomType ?? null,
      nights: stay.nights ?? null,
      checkIn: stay.checkIn ?? null,
      checkOut: stay.checkOut ?? null,
      rating: stay.rating ?? null,
    };
  }
  if (!segments.length) return null;
  // One leg is provably nonstop. More than one leg is not a stop count: it can
  // be a round trip or a multi-city itinerary, so only the vendor may say.
  const stops = raw.stops ?? (segments.length === 1 ? 0 : null);
  const stopNames = raw.stopNames?.length
    ? raw.stopNames
    : segments.slice(0, -1).map((segment) => segment.to);
  return {
    kind: 'flight',
    segments: segments.map((segment) => ({
      from: segment.from,
      to: segment.to,
      departAt: segment.departAt ?? null,
      arriveAt: segment.arriveAt ?? null,
      carrier: segment.carrier ?? null,
    })),
    stops,
    durationMinutes: raw.durationMinutes ?? null,
    stopNames: stops !== null && stopNames.length === stops ? stopNames : [],
  };
}

function flightTitle(segments: z.infer<typeof segmentSchema>[], id: string): string {
  if (!segments.length) return `Flight offer ${id}`;
  const legs = segments.map((leg) => `${leg.from} → ${leg.to}`).join(', ');
  const carrier = segments.find((leg) => leg.carrier)?.carrier;
  return carrier ? `${carrier}: ${legs}` : legs;
}

function flightDetail(segments: z.infer<typeof segmentSchema>[]): string | null {
  if (!segments.length) return null;
  const stops =
    segments.length === 1
      ? 'nonstop'
      : `${segments.length - 1} stop${segments.length > 2 ? 's' : ''}`;
  const parts = segments.map((leg) => {
    const when = leg.departAt ? `departs ${leg.departAt}` : null;
    const arrive = leg.arriveAt ? `arrives ${leg.arriveAt}` : null;
    return [leg.carrier ?? null, when, arrive].filter(Boolean).join(' · ');
  });
  return [stops, ...parts].filter(Boolean).join(' · ');
}

function stayDetail(stay: z.infer<typeof staySchema> | null): string | null {
  if (!stay) return null;
  const parts = [
    stay.roomType ?? null,
    stay.nights ? `${stay.nights} night${stay.nights === 1 ? '' : 's'}` : null,
    stay.checkIn && stay.checkOut ? `${stay.checkIn} to ${stay.checkOut}` : null,
    typeof stay.rating === 'number' ? `rated ${stay.rating}` : null,
  ];
  const line = parts.filter(Boolean).join(' · ');
  return line || null;
}

/**
 * The provider's own claim about a hold, read strictly. `confirmed: true` with a
 * reference is the only thing that becomes a hold; a truthy-but-vague value is
 * kept as a note so an operator can see the provider overreached.
 */
function readHold(raw: unknown): {
  hold: 'none' | 'confirmed';
  ref: string | null;
  expiresAt: string | null;
  note: string | null;
} {
  if (raw === undefined || raw === null || raw === false) {
    return { hold: 'none', ref: null, expiresAt: null, note: null };
  }
  const confirmed = confirmedHoldSchema.safeParse(raw);
  if (confirmed.success) {
    return {
      hold: 'confirmed',
      ref: confirmed.data.ref,
      expiresAt: confirmed.data.expiresAt ?? null,
      note: null,
    };
  }
  return {
    hold: 'none',
    ref: null,
    expiresAt: null,
    note: 'The provider sent hold details without confirming a hold, so this stays an offer.',
  };
}

function refused(reason: ProviderHoldResult['reason'], note: string): ProviderHoldResult {
  return { confirmed: false, ref: null, expiresAt: null, reason, note };
}

/** Date strings the traveler actually wrote, in the order they appeared. */
function explicitDates(text: string): string[] {
  return [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
}

function validDate(candidate: string | undefined): string | undefined {
  return candidate && parseIsoDate(candidate) ? candidate : undefined;
}

function validTravelers(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 12
    ? value
    : undefined;
}

/** A second date only counts as a return when it is after the first. */
function laterDate(candidate: string, after: string): boolean {
  return DATE.test(candidate) && candidate > after;
}

/**
 * Months, weekdays, and the words that turn up next to a preposition in travel
 * talk without being a place. A guessed city sent to a provider costs a real
 * call and returns nonsense, so the obvious ones are refused here.
 */
const NOT_A_CITY = new Set([
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'Christmas',
  'Easter',
  'Summer',
  'Winter',
  'Spring',
  'Autumn',
  'Fall',
  'Anywhere',
  'Somewhere',
  'Tomorrow',
  'Today',
  'Weekend',
]);

/** Everything above, plus the verbs and fillers that sit beside a city in a request. */
const NOT_CITY_WORD = new Set([
  ...NOT_A_CITY,
  'Fly',
  'Flies',
  'Flight',
  'Flights',
  'Flying',
  'Train',
  'Trains',
  'Bus',
  'Drive',
  'Go',
  'Going',
  'Trip',
  'Travel',
  'Book',
  'Booking',
  'Find',
  'Need',
  'Want',
  'Looking',
  'From',
  'To',
  'In',
  'At',
  'For',
  'A',
  'An',
  'The',
  'My',
  'Our',
  'Your',
  'Next',
  'Last',
  'This',
  'That',
  'Cheap',
  'Cheapest',
  'Direct',
  'Nonstop',
  'Round',
  'Hotel',
  'Hotels',
  'Stay',
  'Stays',
  'Room',
  'Rooms',
  'Please',
  'Some',
  'Any',
]);

const PREPOSITIONS = new Set(['to', 'in', 'at', 'for']);
const ROUTE_SEPARATORS = new Set(['to', '→', '->']);

function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[.,!?;:]+$/gu, ''))
    .filter(Boolean);
}

function looksLikeCity(word: string): boolean {
  // Either a two-to-four-letter airport code or a capitalized name.
  return /^[A-Z]{2,4}$/.test(word) || /^\p{Lu}\p{L}+$/u.test(word);
}

/** Up to two city words from `start`, walking in one direction, stopping at filler. */
function cityPhrase(list: string[], start: number, direction: 1 | -1): string | undefined {
  const picked: string[] = [];
  for (let i = start; i >= 0 && i < list.length && picked.length < 2; i += direction) {
    const word = list[i];
    if (!looksLikeCity(word) || NOT_CITY_WORD.has(word)) break;
    if (direction === 1) picked.push(word);
    else picked.unshift(word);
  }
  return picked.length ? picked.join(' ') : undefined;
}

/**
 * `Lagos to Lisbon`, `Fly LOS → ACC`: the route, when the traveler wrote one.
 * The walk backwards from "to" is what keeps "Fly" out of the origin.
 */
function routeFromText(text: string): { origin?: string; destination?: string } {
  const list = words(text);
  for (const [index, word] of list.entries()) {
    if (!ROUTE_SEPARATORS.has(word.toLowerCase())) continue;
    const origin = cityPhrase(list, index - 1, -1);
    const destination = cityPhrase(list, index + 1, 1);
    if (origin || destination) return { origin, destination };
  }
  return {};
}

/** `a hotel in Lisbon`, `fly to Accra`: the first city named after a preposition. */
function destinationFromText(text: string): string | undefined {
  const list = words(text);
  for (const [index, word] of list.entries()) {
    if (!PREPOSITIONS.has(word.toLowerCase())) continue;
    const candidate = cityPhrase(list, index + 1, 1);
    if (candidate) return candidate;
  }
  return undefined;
}

function cleanCity(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/[.,!?]+$/, '');
  if (!trimmed || trimmed.length < 2) return undefined;
  if (NOT_A_CITY.has(trimmed.split(/\s+/)[0])) return undefined;
  return trimmed;
}
