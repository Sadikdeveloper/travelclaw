import { z } from 'zod';
import {
  connectorBase,
  FetchTimeoutError,
  fetchWithRetry,
  NOT_JSON,
  readJson,
  scrubSecrets,
  SEARCH_RETRY,
  SEARCH_TIMEOUT_MS,
} from '../http';
import type {
  AdapterContext,
  AdapterOfferCandidate,
  AdapterOutcome,
  AdapterSearchInput,
  FlightQueryInput,
  ProviderAdapter,
} from './types';

/**
 * FlightAPI.io's one-way and round-trip flight price endpoints.
 *
 * One thing about this vendor is different from every other connector: its key
 * belongs in the URL path, not a header. TravelClaw's rule is that a key travels
 * in a header, so this adapter makes the exception explicit and contains it —
 * the assembled URL is never logged, never stored, never put in a summary, and
 * every string this file returns is passed through `scrubSecrets` first, so a
 * vendor error that echoed the path cannot carry the key into a task row or a
 * model prompt.
 *
 * Google Flights' `departure_id` is the same story for the other adapter: this
 * vendor also needs airport codes. A city name is resolved only from an operator
 * alias (`cityCodes`); nothing here guesses an airport from a city.
 */

const FLIGHTAPI_DEFAULT_BASE = 'https://api.flightapi.io';
const AIRPORT_CODE = /^[A-Z]{3}$/;
/** The vendor's cabin values; the desk's query has no cabin field yet. */
const DEFAULT_CABIN = 'Economy';

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

const priceSchema = z.object({
  amount: z.union([z.number(), z.string()]).nullish(),
  update_status: z.string().trim().max(24).nullish(),
});

const pricingOptionSchema = z.object({
  price: priceSchema.nullish(),
  items: z
    .array(
      z.object({
        agent_id: z.string().trim().max(40).nullish(),
        url: z.string().trim().max(4000).nullish(),
      }),
    )
    .max(10)
    .nullish(),
});

const itinerarySchema = z.object({
  id: z.string().trim().min(1).max(200),
  leg_ids: z.array(z.string().trim().min(1).max(200)).max(8).nullish(),
  pricing_options: z.array(z.unknown()).max(20).nullish(),
});

const placeSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  name: z.string().trim().max(120).nullish(),
  code: z.string().trim().max(12).nullish(),
  iata: z.string().trim().max(12).nullish(),
  city_code: z.string().trim().max(12).nullish(),
});

const carrierSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  name: z.string().trim().max(120).nullish(),
  code: z.string().trim().max(12).nullish(),
  iata: z.string().trim().max(12).nullish(),
});

const legSchema = z.object({
  id: z.string().trim().min(1).max(200).nullish(),
  origin_place_id: z.union([z.string(), z.number()]).nullish(),
  destination_place_id: z.union([z.string(), z.number()]).nullish(),
  segment_ids: z.array(z.string().trim().min(1).max(200)).max(12).nullish(),
  duration: z.number().nonnegative().nullish(),
  stop_count: z.number().int().min(0).max(12).nullish(),
  marketing_carrier_ids: z
    .array(z.union([z.string(), z.number()]))
    .max(6)
    .nullish(),
});

const segmentSchema = z.object({
  id: z.string().trim().min(1).max(200).nullish(),
  origin_place_id: z.union([z.string(), z.number()]).nullish(),
  destination_place_id: z.union([z.string(), z.number()]).nullish(),
  departure: z.string().trim().max(40).nullish(),
  arrival: z.string().trim().max(40).nullish(),
  marketing_carrier_id: z.union([z.string(), z.number()]).nullish(),
});

const payloadSchema = z.object({
  itineraries: z.array(z.unknown()).max(120).nullish(),
  legs: z.array(z.unknown()).max(120).nullish(),
  segments: z.array(z.unknown()).max(400).nullish(),
  places: z.array(z.unknown()).max(400).nullish(),
  carriers: z.array(z.unknown()).max(200).nullish(),
});

export const flightapiAdapter: ProviderAdapter = {
  id: 'flightapi',
  label: 'FlightAPI.io flight prices',
  slots: ['flight'],
  // The vendor returns fares from airlines and agencies; it has no hold
  // endpoint, so a hold is refused rather than requested from the wrong place.
  hold: 'unsupported',
  defaultBaseUrl: FLIGHTAPI_DEFAULT_BASE,

  async search(input: AdapterSearchInput, ctx: AdapterContext): Promise<AdapterOutcome> {
    if (!ctx.credential.apiKey) {
      return { ok: false, reason: 'no_key', detail: 'no operator key is configured.' };
    }
    const query = input.query as FlightQueryInput;
    const origin = resolveAirport(query.origin, ctx);
    if (!origin) {
      return fail(
        'bad_query',
        `needs an IATA airport code for "${query.origin.trim()}", and this source has no city lookup. Add a cityCodes alias for it or ask with an airport code.`,
        ctx,
      );
    }
    const destination = resolveAirport(query.destination, ctx);
    if (!destination) {
      return fail(
        'bad_query',
        `needs an IATA airport code for "${query.destination.trim()}", and this source has no city lookup. Add a cityCodes alias for it or ask with an airport code.`,
        ctx,
      );
    }

    // The vendor requires a currency and a point-of-sale region in the request.
    // The desk sends what the traveler or operator stated and otherwise asks for
    // USD, which is the currency the offer is then labelled with.
    const currency = (input.market.currency ?? 'USD').toUpperCase();
    const base = connectorBase(ctx.credential.baseUrl, FLIGHTAPI_DEFAULT_BASE);
    const key = ctx.credential.apiKey;
    const trip = query.returnDate ? 'roundtrip' : 'onewaytrip';
    const dates = query.returnDate
      ? `${query.departDate}/${query.returnDate}`
      : query.departDate;
    const path = [
      trip,
      key,
      origin,
      destination,
      ...dates.split('/'),
      String(clampParty(query.travelers)),
      '0',
      '0',
      DEFAULT_CABIN,
      currency,
    ];
    const region = input.market.bookerCountry
      ? `?region=${encodeURIComponent(input.market.bookerCountry.toUpperCase())}`
      : '';

    let response: Response;
    try {
      response = await fetchWithRetry(
        ctx.fetchImpl,
        `${base}/${path.join('/')}${region}`,
        SEARCH_TIMEOUT_MS,
        {
          headers: { Accept: 'application/json' },
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
      ctx.tool.connectors?.rejected?.('flight');
      return fail(
        'unauthorized',
        `rejected the operator key (HTTP ${response.status}).`,
        ctx,
      );
    }
    if (!response.ok) return fail('http_error', `answered HTTP ${response.status}.`, ctx);

    const body = await readJson(response);
    if (body === NOT_JSON)
      return fail('bad_payload', 'answered with something that is not JSON.', ctx);
    const payload = payloadSchema.safeParse(body);
    if (!payload.success) {
      const message = vendorError(body);
      return fail(
        'bad_payload',
        message
          ? `answered with an error instead of results: ${message}`
          : 'answered, but not with an itinerary list this desk reads.',
        ctx,
      );
    }

    const itineraries = Array.isArray(payload.data.itineraries)
      ? payload.data.itineraries
      : [];
    if (!itineraries.length && vendorError(body)) {
      return fail(
        'bad_payload',
        `answered with an error instead of results: ${vendorError(body)}`,
        ctx,
      );
    }
    const legs = indexById(payload.data.legs ?? [], legSchema);
    const segments = indexById(payload.data.segments ?? [], segmentSchema);
    const placeNames = nameIndex(payload.data.places ?? [], placeSchema, [
      'code',
      'iata',
      'city_code',
      'name',
    ]);
    const carrierNames = nameIndex(payload.data.carriers ?? [], carrierSchema, [
      'name',
      'code',
      'iata',
    ]);

    const offers: AdapterOfferCandidate[] = [];
    let dropped = 0;
    for (const [index, raw] of itineraries.entries()) {
      const candidate = itineraryCandidate(raw, {
        legs,
        segments,
        placeNames,
        carrierNames,
        query,
        currency,
        index,
      });
      if (candidate) offers.push(candidate);
      else dropped += 1;
    }
    return { ok: true, offers, dropped };
  },
};

function itineraryCandidate(
  raw: unknown,
  context: {
    legs: Map<string, z.infer<typeof legSchema>>;
    segments: Map<string, z.infer<typeof segmentSchema>>;
    placeNames: Map<string, string>;
    carrierNames: Map<string, string>;
    query: FlightQueryInput;
    currency: string;
    index: number;
  },
): AdapterOfferCandidate | undefined {
  const itinerary = itinerarySchema.safeParse(raw);
  if (!itinerary.success) return undefined;
  const price = bestPrice(itinerary.data.pricing_options ?? []);
  if (!price) return undefined;
  const amount = price.amount;

  const legs = (itinerary.data.leg_ids ?? [])
    .map((id) => context.legs.get(id))
    .filter((leg): leg is z.infer<typeof legSchema> => leg !== undefined);

  // The vendor's own lists name every stop. The first leg's origin and the last
  // leg's destination are the airports this search asked for, so those two ids
  // can be told apart from a stop without another lookup.
  const endpointCodes = new Map<string, string>();
  const first = legs[0];
  const last = legs.at(-1);
  if (first?.origin_place_id !== undefined && first.origin_place_id !== null) {
    endpointCodes.set(
      String(first.origin_place_id),
      context.query.origin.trim().toUpperCase(),
    );
  }
  if (last?.destination_place_id !== undefined && last.destination_place_id !== null) {
    endpointCodes.set(
      String(last.destination_place_id),
      context.query.destination.trim().toUpperCase(),
    );
  }
  const place = (id: unknown): string | undefined => {
    if (id === undefined || id === null) return undefined;
    return context.placeNames.get(String(id)) ?? endpointCodes.get(String(id));
  };

  const segments: NonNullable<AdapterOfferCandidate['segments']> = [];
  let complete = legs.length > 0;
  for (const leg of legs) {
    for (const segmentId of leg.segment_ids ?? []) {
      const segment = context.segments.get(segmentId);
      const from = segment ? place(segment.origin_place_id) : undefined;
      const to = segment ? place(segment.destination_place_id) : undefined;
      if (!segment || !from || !to) {
        complete = false;
        break;
      }
      segments.push({
        from,
        to,
        departAt: segment.departure ?? null,
        arriveAt: segment.arrival ?? null,
        carrier: carrierName(segment.marketing_carrier_id, context.carrierNames),
      });
    }
    if (!complete) break;
  }

  const carrierNames = [
    ...new Set(
      legs
        .flatMap((leg) => leg.marketing_carrier_ids ?? [])
        .map((id) => carrierName(id, context.carrierNames))
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const duration = legs.reduce((total, leg) => total + (leg.duration ?? 0), 0);
  const stops = legs.reduce((total, leg) => total + (leg.stop_count ?? 0), 0);
  const id =
    itinerary.data.id.length <= 120
      ? itinerary.data.id
      : `flightapi-${itinerary.data.id.slice(0, 88)}#${hash(itinerary.data.id)}`;

  if (complete) {
    // Where the traveler changes planes: every leg's endpoint except the last,
    // which is the destination. Derived from the vendor's own leg structure.
    const stopNames: string[] = [];
    for (const segment of segments.slice(0, -1)) stopNames.push(segment.to);
    return {
      id,
      price: { amount, currency: context.currency },
      ...(price.bookingUrl ? { bookingUrl: price.bookingUrl } : {}),
      segments,
      stops: legs.length ? stops : null,
      durationMinutes: duration > 0 ? duration : null,
      stopNames,
    };
  }
  // Without a name for every stop, a partial segment list would hide a
  // stopover. The offer keeps the provider's price, duration, and stop count,
  // and says less rather than something untrue.
  const title = [
    `${context.query.origin.trim().toUpperCase()} → ${context.query.destination.trim().toUpperCase()}`,
    carrierNames.length ? carrierNames.join(', ') : null,
  ]
    .filter(Boolean)
    .join(': ');
  const detail = [
    duration > 0 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : null,
    legs.length ? `${stops} stop${stops === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id,
    price: { amount, currency: context.currency },
    ...(price.bookingUrl ? { bookingUrl: price.bookingUrl } : {}),
    title,
    ...(detail ? { detail } : {}),
    // Even without a name for every stop, the vendor's own counts are real.
    stops: legs.length ? stops : null,
    durationMinutes: duration > 0 ? duration : null,
  };
}

/**
 * The cheapest price the vendor quoted for this itinerary, preferring options it
 * still marks current. A stale-only itinerary keeps the vendor's number and is
 * not re-priced or hidden.
 */
function bestPrice(
  options: unknown[],
): { amount: number; bookingUrl?: string } | undefined {
  const prices: Array<{ amount: number; current: boolean; bookingUrl?: string }> = [];
  for (const raw of options) {
    const option = pricingOptionSchema.safeParse(raw);
    if (!option.success) continue;
    const amount = money(option.data.price?.amount);
    if (amount === undefined) continue;
    const bookingUrl = option.data.items
      ?.map((item) => item.url?.trim())
      .find((url): url is string => Boolean(url && url.length <= 2048));
    prices.push({
      amount,
      current: option.data.price?.update_status === 'current',
      ...(bookingUrl ? { bookingUrl } : {}),
    });
  }
  const current = prices.filter((price) => price.current);
  const pool = current.length ? current : prices;
  if (!pool.length) return undefined;
  const amount = Math.min(...pool.map((price) => price.amount));
  const best = pool
    .filter((price) => price.amount === amount)
    .find((price) => price.bookingUrl);
  return { amount, ...(best?.bookingUrl ? { bookingUrl: best.bookingUrl } : {}) };
}

function resolveAirport(value: string, ctx: AdapterContext): string | undefined {
  const trimmed = value.trim();
  if (AIRPORT_CODE.test(trimmed.toUpperCase())) return trimmed.toUpperCase();
  const alias = ctx.credential.cityCodes?.[trimmed.toLowerCase()];
  if (alias && AIRPORT_CODE.test(alias.trim().toUpperCase()))
    return alias.trim().toUpperCase();
  return undefined;
}

function indexById<T extends { id?: string | null | number | undefined }>(
  entries: unknown[],
  schema: z.ZodType<T>,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const raw of entries) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) continue;
    const id = parsed.data.id;
    if (id === undefined || id === null) continue;
    index.set(String(id), parsed.data);
  }
  return index;
}

/**
 * Place and carrier lists are referenced by id. A place is labelled with its
 * airport code when the vendor sent one (a traveler reads `HEL`, not a full
 * airport name), a carrier with its name.
 */
function nameIndex(
  entries: unknown[],
  schema: z.ZodType<{ id?: string | null | number | undefined }>,
  preferred: string[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const raw of entries) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) continue;
    const id = parsed.data.id;
    if (id === undefined || id === null) continue;
    const named = parsed.data as Record<string, unknown>;
    const name = preferred
      .map((field) => named[field])
      .find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      );
    if (name) index.set(String(id), name.trim());
  }
  return index;
}

function carrierName(id: unknown, carriers: Map<string, string>): string | null {
  if (id === undefined || id === null) return null;
  return carriers.get(String(id)) ?? null;
}

function money(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d{1,12}(\.\d{1,3})?$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function clampParty(travelers: number): number {
  if (!Number.isFinite(travelers)) return 1;
  return Math.min(Math.max(Math.trunc(travelers), 1), 9);
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

function hash(value: string): string {
  let digest = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    digest ^= value.charCodeAt(index);
    digest = Math.imul(digest, 0x01000193) >>> 0;
  }
  return digest.toString(36);
}
