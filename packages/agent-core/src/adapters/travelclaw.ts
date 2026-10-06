import { z } from 'zod';
import {
  authHeaders,
  connectorBase,
  FetchTimeoutError,
  fetchWithTimeout,
  NOT_JSON,
  readJson,
  SEARCH_TIMEOUT_MS,
} from '../http';
import type { FlightQueryInput, ProviderAdapter, StayQueryInput } from './types';

/**
 * The normalized contract an operator-hosted adapter implements:
 * `GET {base}/search/flights`, `GET {base}/search/stays`, `POST {base}/holds`.
 * This is the original TravelClaw shape and stays the default, so an install
 * that already runs a compatible adapter is untouched by the vendor adapters.
 */

const searchPayloadSchema = z.object({
  provider: z.string().trim().min(1).max(80).nullish(),
  offers: z.array(z.unknown()).max(50),
});

export const travelclawAdapter: ProviderAdapter = {
  id: 'travelclaw',
  label: 'TravelClaw provider contract',
  slots: ['flight', 'stay'],
  // The contract carries a hold endpoint, and a hold is still believed only when
  // its answer confirms one with a reference.
  hold: 'provider',
  defaultBaseUrl: null,

  async search(input, ctx) {
    const base = connectorBase(ctx.credential.baseUrl, '');
    if (!ctx.credential.apiKey)
      return { ok: false, reason: 'no_key', detail: 'no operator key is configured.' };
    if (!base)
      return {
        ok: false,
        reason: 'no_base_url',
        detail: 'no usable base URL is configured.',
      };

    const params =
      input.kind === 'flight'
        ? flightParams(input.query as FlightQueryInput)
        : stayParams(input.query as StayQueryInput);
    if (input.market.bookerCountry) params.set('bookerCountry', input.market.bookerCountry);
    if (input.market.currency) params.set('currency', input.market.currency);
    if (input.market.language) params.set('language', input.market.language);

    const path = input.kind === 'flight' ? '/search/flights' : '/search/stays';
    let response: Response;
    try {
      response = await fetchWithTimeout(
        ctx.fetchImpl,
        `${base}${path}?${params}`,
        SEARCH_TIMEOUT_MS,
        { headers: { ...authHeaders(ctx.credential.apiKey), Accept: 'application/json' } },
      );
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        return {
          ok: false,
          reason: 'timeout',
          detail: `did not answer within ${SEARCH_TIMEOUT_MS}ms.`,
        };
      }
      return {
        ok: false,
        reason: 'network_error',
        detail: 'could not be reached or redirected the request elsewhere.',
      };
    }

    if (response.status === 401 || response.status === 403) {
      ctx.tool.connectors?.rejected?.(input.kind);
      return {
        ok: false,
        reason: 'unauthorized',
        detail: `rejected the operator key (HTTP ${response.status}).`,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: 'http_error',
        detail: `answered HTTP ${response.status}.`,
      };
    }

    const body = await readJson(response);
    if (body === NOT_JSON) {
      return {
        ok: false,
        reason: 'bad_payload',
        detail: 'answered with something that is not JSON.',
      };
    }
    const payload = searchPayloadSchema.safeParse(body);
    if (!payload.success) {
      return {
        ok: false,
        reason: 'bad_payload',
        detail: 'answered, but not with an offer list this desk reads.',
      };
    }
    return {
      ok: true,
      ...(payload.data.provider ? { provider: payload.data.provider } : {}),
      offers: payload.data.offers,
    };
  },
};

function flightParams(query: FlightQueryInput): URLSearchParams {
  const params = new URLSearchParams({
    origin: query.origin,
    destination: query.destination,
    departDate: query.departDate,
    travelers: String(query.travelers),
  });
  if (query.returnDate) params.set('returnDate', query.returnDate);
  return params;
}

function stayParams(query: StayQueryInput): URLSearchParams {
  return new URLSearchParams({
    destination: query.destination,
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    travelers: String(query.travelers),
  });
}
