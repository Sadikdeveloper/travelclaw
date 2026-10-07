import { z } from 'zod';
import {
  authHeaders,
  connectorBase,
  FetchTimeoutError,
  fetchWithRetry,
  NOT_JSON,
  readJson,
  scrubSecrets,
  SEARCH_RETRY,
  SEARCH_TIMEOUT_MS,
} from '../http';
import { parseIsoDate } from '../dates';
import type { DeskKind } from '../desks';
import type {
  AdapterContext,
  AdapterOfferCandidate,
  AdapterOutcome,
  AdapterSearchInput,
  FlightQueryInput,
  ProviderAdapter,
  StayQueryInput,
} from './types';

/**
 * SerpApi's Google Flights and Google Hotels engines.
 *
 * Credentials: the desk's rule is a header, so the first request carries the key
 * as `Authorization: Bearer`. SerpApi documents its key as the `api_key`
 * parameter and does not document the header, so if the vendor answers 401 the
 * adapter retries once with `api_key` in the query string and remembers that per
 * source for the life of the process. When the header is accepted the key never
 * enters a URL at all; when it is not, the key travels only where the vendor's
 * own documentation puts it, and every string this file returns is scrubbed, so
 * it cannot reach a log line, a summary, a task row, or a model prompt.
 *
 * Two vendor facts shape the mapping:
 *
 * - Google Flights identifies a place by airport code or Google location id
 *   (kgmid), never by a city name. `google_flights_autocomplete` is the vendor's
 *   own lookup for turning the traveler's words into one of those ids, and an
 *   operator can also pin an alias with `cityCodes`.
 * - SerpApi prices in USD unless asked otherwise, and echoes the currency it
 *   used in `search_parameters`. That echo is what the offer is labelled with;
 *   the desk never converts a price.
 */

const SERPAPI_DEFAULT_BASE = 'https://serpapi.com';
const AUTOCOMPLETE_LIMIT = 80;

/** An airport code, a Google location id, or a comma-separated list of either. */
const AIRPORT_CODE = /^[A-Z]{3}$/;
const LOCATION_ID = /^\/[mg]\/[A-Za-z0-9_]+$/;
const CODE_LIST = /^[A-Z]{3}(,[A-Z]{3}){0,7}$/;

interface Failure {
  ok: false;
  reason:
    | 'no_key'
    | 'bad_query'
    | 'unauthorized'
    | 'http_error'
    | 'timeout'
    | 'network_error'
    | 'bad_payload';
  detail: string;
}

type Fetched = { ok: true; body: unknown } | FetchFailure;

const autocompleteSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160).nullish(),
        id: z.string().trim().min(1).max(200).nullish(),
        airports: z
          .array(z.object({ id: z.string().trim().min(1).max(24).nullish() }))
          .max(12)
          .nullish(),
      }),
    )
    .max(25)
    .nullish(),
});

const flightLegSchema = z.object({
  departure_airport: z
    .object({
      id: z.string().trim().min(1).max(24).nullish(),
      time: z.string().trim().max(40).nullish(),
    })
    .nullish(),
  arrival_airport: z
    .object({
      id: z.string().trim().min(1).max(24).nullish(),
      time: z.string().trim().max(40).nullish(),
    })
    .nullish(),
  airline: z.string().trim().min(1).max(80).nullish(),
  flight_number: z.string().trim().min(1).max(24).nullish(),
  travel_class: z.string().trim().max(40).nullish(),
});

const layoverSchema = z.object({
  name: z.string().trim().min(1).max(120).nullish(),
  id: z.string().trim().min(1).max(24).nullish(),
  duration: z.number().nonnegative().nullish(),
});

const flightBundleSchema = z.object({
  flights: z.array(flightLegSchema).min(1).max(8),
  price: z.union([z.number(), z.string()]).nullish(),
  total_duration: z.number().nonnegative().nullish(),
  // Google names each connection. Its length is also the vendor's own stop count.
  layovers: z.array(layoverSchema).max(8).nullish(),
});

const flightPayloadSchema = z.object({
  best_flights: z.array(z.unknown()).max(80).nullish(),
  other_flights: z.array(z.unknown()).max(80).nullish(),
  search_parameters: z.object({ currency: z.string().trim().max(8).nullish() }).nullish(),
});

const rateSchema = z.object({
  extracted_lowest: z.number().nonnegative().nullish(),
  lowest: z.string().trim().max(40).nullish(),
});

const hotelPropertySchema = z.object({
  name: z.string().trim().min(1).max(160).nullish(),
  property_token: z.string().trim().min(1).max(200).nullish(),
  rate_per_night: rateSchema.nullish(),
  total_rate: rateSchema.nullish(),
  overall_rating: z.number().min(0).max(10).nullish(),
  check_in_time: z.string().trim().max(40).nullish(),
  check_out_time: z.string().trim().max(40).nullish(),
});

const hotelPayloadSchema = z.object({
  properties: z.array(z.unknown()).max(80).nullish(),
  search_parameters: z.object({ currency: z.string().trim().max(8).nullish() }).nullish(),
});

export const serpapiAdapter: ProviderAdapter = {
  id: 'serpapi',
  label: 'SerpApi Google Flights and Hotels',
  slots: ['flight', 'stay'],
  // Google Flights and Google Hotels quote fares and rooms; neither vendor API
  // this adapter calls can reserve one. The desk says so instead of sending an
  // offer id to an endpoint that would only pretend to hold it.
  hold: 'unsupported',
  defaultBaseUrl: SERPAPI_DEFAULT_BASE,

  async search(input, ctx) {
    if (!ctx.credential.apiKey) {
      return { ok: false, reason: 'no_key', detail: 'no operator key is configured.' };
    }
    return input.kind === 'flight' ? searchFlights(input, ctx) : searchStays(input, ctx);
  },
};

async function searchFlights(
  input: AdapterSearchInput,
  ctx: AdapterContext,
): Promise<AdapterOutcome> {
  const query = input.query as FlightQueryInput;
  const base = baseUrl(ctx);
  const origin = await resolveFlightPlace(query.origin, input, ctx, base);
  if (!origin.ok)
    return fail('bad_query', `could not name a departure airport: ${origin.detail}`, ctx);
  const destination = await resolveFlightPlace(query.destination, input, ctx, base);
  if (!destination.ok)
    return fail(
      'bad_query',
      `could not name an arrival airport: ${destination.detail}`,
      ctx,
    );

  const params = new URLSearchParams({ engine: 'google_flights' });
  params.set('departure_id', origin.id);
  params.set('arrival_id', destination.id);
  params.set('outbound_date', query.departDate);
  params.set('type', query.returnDate ? '1' : '2');
  if (query.returnDate) params.set('return_date', query.returnDate);
  params.set('adults', String(clampParty(query.travelers)));
  addLocale(params, input);

  const fetched = await serpApiJson(params, ctx, base, 'flight');
  if (!fetched.ok) return fetched;
  const payload = flightPayloadSchema.safeParse(fetched.body);
  if (!payload.success) return vendorShapeFailure(fetched.body, ctx);

  const currency = normalizeCurrency(payload.data.search_parameters?.currency) ?? 'USD';
  const bundles = [
    ...(payload.data.best_flights ?? []),
    ...(payload.data.other_flights ?? []),
  ];
  // An error body that also carries no result list is a failure, not an empty
  // search. An answer that simply has nothing to offer stays zero offers.
  if (!bundles.length && vendorError(fetched.body))
    return vendorShapeFailure(fetched.body, ctx);
  const offers: AdapterOfferCandidate[] = [];
  let dropped = 0;
  for (const [index, raw] of bundles.entries()) {
    const candidate = flightCandidate(raw, currency, index);
    if (candidate) offers.push(candidate);
    else dropped += 1;
  }
  return { ok: true, offers, dropped };
}

async function searchStays(
  input: AdapterSearchInput,
  ctx: AdapterContext,
): Promise<AdapterOutcome> {
  const query = input.query as StayQueryInput;
  const base = baseUrl(ctx);
  const params = new URLSearchParams({ engine: 'google_hotels' });
  params.set('q', query.destination.slice(0, 120));
  params.set('check_in_date', query.checkIn);
  params.set('check_out_date', query.checkOut);
  params.set('adults', String(clampParty(query.travelers)));
  addLocale(params, input);

  const fetched = await serpApiJson(params, ctx, base, 'stay');
  if (!fetched.ok) return fetched;
  const payload = hotelPayloadSchema.safeParse(fetched.body);
  if (!payload.success) return vendorShapeFailure(fetched.body, ctx);

  const properties = payload.data.properties ?? [];
  if (!properties.length && vendorError(fetched.body))
    return vendorShapeFailure(fetched.body, ctx);
  const requested = normalizeCurrency(input.market.currency);
  const echoed = normalizeCurrency(payload.data.search_parameters?.currency);
  const nights = nightCount(query.checkIn, query.checkOut);
  const offers: AdapterOfferCandidate[] = [];
  let dropped = 0;
  for (const [index, raw] of properties.entries()) {
    const candidate = stayCandidate(raw, { requested, echoed, nights, query, index });
    if (candidate) offers.push(candidate);
    else dropped += 1;
  }
  return { ok: true, offers, dropped };
}

function flightCandidate(
  raw: unknown,
  currency: string,
  index: number,
): AdapterOfferCandidate | undefined {
  const bundle = flightBundleSchema.safeParse(raw);
  if (!bundle.success) return undefined;
  const price = money(bundle.data.price);
  if (price === undefined) return undefined;

  const segments: NonNullable<AdapterOfferCandidate['segments']> = [];
  for (const leg of bundle.data.flights) {
    const from = leg.departure_airport?.id?.trim();
    const to = leg.arrival_airport?.id?.trim();
    if (!from || !to) return undefined;
    segments.push({
      from,
      to,
      departAt: leg.departure_airport?.time?.trim() || null,
      arriveAt: leg.arrival_airport?.time?.trim() || null,
      carrier: leg.airline?.trim() || null,
    });
  }
  const composite = bundle.data.flights
    .map((leg) => `${leg.flight_number ?? ''}@${leg.departure_airport?.time ?? ''}`)
    .join('|');
  const layovers = bundle.data.layovers ?? [];
  const stopNames = layovers
    .map((layover) => layover.name?.trim())
    .filter((name): name is string => Boolean(name));
  return {
    id: hashedId('serpapi-flight', composite || `bundle-${index}`, 88),
    price: { amount: price, currency },
    segments,
    stops: layovers.length,
    durationMinutes: bundle.data.total_duration ?? null,
    stopNames,
  };
}

function stayCandidate(
  raw: unknown,
  context: {
    requested: string | undefined;
    echoed: string | undefined;
    nights: number | undefined;
    query: StayQueryInput;
    index: number;
  },
): AdapterOfferCandidate | undefined {
  const property = hotelPropertySchema.safeParse(raw);
  if (!property.success) return undefined;
  const name = property.data.name?.trim();
  if (!name) return undefined;

  const total = money(property.data.total_rate?.extracted_lowest);
  const perNight = money(property.data.rate_per_night?.extracted_lowest);
  // The vendor's own total first. A nightly rate is multiplied only by the nights
  // the traveler asked for, and only when no total was sent.
  const amount =
    total ??
    (perNight !== undefined && context.nights ? perNight * context.nights : undefined);
  if (amount === undefined) return undefined;

  const currency =
    currencyIn(property.data.total_rate?.lowest) ??
    currencyIn(property.data.rate_per_night?.lowest) ??
    context.requested ??
    context.echoed ??
    'USD';
  const token = property.data.property_token?.trim();
  const id =
    token && token.length <= 120
      ? token
      : hashedId('serpapi-hotel', `${name}|${context.index}`, 88);
  return {
    id,
    price: { amount, currency },
    title: name,
    stay: {
      name,
      roomType: null,
      nights: context.nights ?? null,
      checkIn: context.query.checkIn,
      checkOut: context.query.checkOut,
      rating: property.data.overall_rating ?? null,
    },
  };
}

/**
 * The traveler's words for a place, as the vendor's own id for it. An airport
 * code or location id already passes through; an operator alias is used next;
 * the vendor's autocomplete is the only other source. Nothing here invents a
 * code, and an unresolved city refuses the search rather than shopping a guess.
 */
async function resolveFlightPlace(
  value: string,
  input: AdapterSearchInput,
  ctx: AdapterContext,
  base: string,
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, detail: 'the query named no place.' };
  if (isFlightPlaceId(trimmed)) return { ok: true, id: trimmed };

  const alias = ctx.credential.cityCodes?.[trimmed.toLowerCase()];
  if (alias && isFlightPlaceId(alias)) return { ok: true, id: alias };

  const params = new URLSearchParams({
    engine: 'google_flights_autocomplete',
    q: trimmed.slice(0, AUTOCOMPLETE_LIMIT),
  });
  addLocale(params, input);
  const fetched = await serpApiJson(params, ctx, base, 'flight');
  if (!fetched.ok) return { ok: false, detail: fetched.detail };
  const parsed = autocompleteSchema.safeParse(fetched.body);
  if (!parsed.success)
    return { ok: false, detail: 'answered the city lookup with an unexpected shape.' };

  for (const suggestion of parsed.data.suggestions ?? []) {
    const id = suggestion.id?.trim();
    if (id && isFlightPlaceId(id)) return { ok: true, id };
    for (const airport of suggestion.airports ?? []) {
      const code = airport.id?.trim();
      if (code && isFlightPlaceId(code)) return { ok: true, id: code };
    }
  }
  return { ok: false, detail: `"${trimmed}" is not an airport or city this source knows.` };
}

function isFlightPlaceId(value: string): boolean {
  return AIRPORT_CODE.test(value) || LOCATION_ID.test(value) || CODE_LIST.test(value);
}

async function serpApiJson(
  params: URLSearchParams,
  ctx: AdapterContext,
  base: string,
  slot: DeskKind,
): Promise<Fetched> {
  const key = ctx.credential.apiKey ?? '';
  const sourceKey = `${base}\u0000${fingerprint(key)}`;
  const queryKeyPreferred = queryKeySources.has(sourceKey);
  const first = await serpApiFetch(params, ctx, base, queryKeyPreferred ? key : undefined);

  if (first.ok || first.status !== 401 || queryKeyPreferred) {
    if (!first.ok && first.status === 401) ctx.tool.connectors?.rejected?.(slot);
    return first;
  }
  // The vendor ignored the header. Retry the way its own documentation says to.
  const retried = await serpApiFetch(params, ctx, base, key);
  if (retried.ok) {
    queryKeySources.add(sourceKey);
    return retried;
  }
  // Only the final answer is reported, so one refused search counts as one.
  if (retried.status === 401) ctx.tool.connectors?.rejected?.(slot);
  return retried;
}

/**
 * Sources that answered the header with 401, per process. Keyed by host and a
 * digest of the key, so the flag is not shared across operators and the key
 * itself is never held here.
 */
const queryKeySources = new Set<string>();

type FetchFailure = Failure & { status?: number };

function fingerprint(value: string): string {
  let digest = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    digest ^= value.charCodeAt(index);
    digest = Math.imul(digest, 0x01000193) >>> 0;
  }
  return digest.toString(36);
}

async function serpApiFetch(
  params: URLSearchParams,
  ctx: AdapterContext,
  base: string,
  queryKey: string | undefined,
): Promise<Fetched & { status?: number }> {
  const search = new URLSearchParams(params);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (queryKey) search.set('api_key', queryKey);
  else Object.assign(headers, authHeaders(ctx.credential.apiKey));

  let response: Response;
  try {
    response = await fetchWithRetry(
      ctx.fetchImpl,
      `${base}/search?${search}`,
      SEARCH_TIMEOUT_MS,
      {
        headers,
      },
      { ...SEARCH_RETRY, signal: ctx.tool.signal },
    );
  } catch (error) {
    if (error instanceof FetchTimeoutError) {
      return fail('timeout', `did not answer within ${SEARCH_TIMEOUT_MS}ms.`, ctx);
    }
    return fail(
      'network_error',
      'could not be reached or redirected the request elsewhere.',
      ctx,
    );
  }
  if (response.status === 401 || response.status === 403) {
    const failure = fail(
      'unauthorized',
      `rejected the operator key (HTTP ${response.status}).`,
      ctx,
    );
    return { ...failure, status: response.status };
  }
  if (!response.ok) {
    const failure = fail('http_error', `answered HTTP ${response.status}.`, ctx);
    return { ...failure, status: response.status };
  }
  const body = await readJson(response);
  if (body === NOT_JSON)
    return fail('bad_payload', 'answered with something that is not JSON.', ctx);
  return { ok: true, body };
}

/** A vendor error body is reported as a shape failure, never echoed verbatim. */
function vendorShapeFailure(body: unknown, ctx: AdapterContext): Failure {
  const message = vendorError(body);
  return fail(
    'bad_payload',
    message
      ? `answered with an error instead of results: ${message}`
      : 'answered, but not with a result list this desk reads.',
    ctx,
  );
}

function vendorError(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const message = (body as { error?: unknown }).error;
  if (typeof message !== 'string') return undefined;
  const trimmed = message.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 160) : undefined;
}

function fail(reason: Failure['reason'], detail: string, ctx: AdapterContext): Failure {
  return { ok: false, reason, detail: scrubSecrets(detail, [ctx.credential.apiKey]) };
}

function baseUrl(ctx: AdapterContext): string {
  return connectorBase(ctx.credential.baseUrl, SERPAPI_DEFAULT_BASE);
}

function addLocale(params: URLSearchParams, input: AdapterSearchInput): void {
  if (input.market.bookerCountry)
    params.set('gl', input.market.bookerCountry.toLowerCase());
  if (input.market.language) params.set('hl', input.market.language.toLowerCase());
  const currency = normalizeCurrency(input.market.currency);
  if (currency) params.set('currency', currency);
}

function clampParty(travelers: number): number {
  if (!Number.isFinite(travelers)) return 1;
  return Math.min(Math.max(Math.trunc(travelers), 1), 9);
}

function money(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d{1,12}(\.\d{1,3})?$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function normalizeCurrency(value: string | null | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : undefined;
}

/** `"MYR 528"` names its currency; `"$528"` does not, and is left unresolved. */
function currencyIn(value: string | null | undefined): string | undefined {
  const match = /^([A-Za-z]{3})\s+\S/.exec(value?.trim() ?? '');
  return match ? match[1].toUpperCase() : undefined;
}

function nightCount(checkIn: string, checkOut: string): number | undefined {
  const start = parseIsoDate(checkIn);
  const end = parseIsoDate(checkOut);
  if (!start || !end) return undefined;
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return nights > 0 ? nights : undefined;
}

/**
 * A stable id built from the vendor's own itinerary facts. It is not the
 * vendor's booking token: that token is what a booking-options request would
 * need, and the desk does not store a field it cannot yet use.
 */
function hashedId(prefix: string, composite: string, head: number): string {
  const digest = fnv1a(composite).toString(36);
  return `${prefix}-${composite.replace(/\s+/g, '').slice(0, head)}#${digest}`;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
