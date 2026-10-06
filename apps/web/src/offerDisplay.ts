import {
  offerCarriers,
  offerFactsLine,
  offerDurationLabel,
  offerRoute,
  type OfferFacts,
  type OfferRecord,
} from '@travelclaw/shared';

/**
 * Turning an offer's vendor facts into the lines a card shows. The wording for
 * stops, duration, nights, and ratings comes from the shared helpers, so the
 * desk's brief and this card never describe the same offer differently. Times are
 * the only web-specific part: they are read from the vendor's own timestamps.
 */

export interface OfferRow {
  /** Carrier (flight) or property name (stay): the card's lead line. */
  lead: string;
  /** Route codes, room type, or nothing. */
  qualifier: string | null;
  /** Times, dates, or the check-in window. */
  when: string | null;
  /** Stops, duration, nights, rating — the facts line. */
  facts: string | null;
}

export function offerRow(offer: OfferRecord): OfferRow | null {
  const facts = offer.facts;
  if (!facts) return null;
  if (facts.kind === 'stay') {
    return {
      lead: facts.name,
      qualifier: facts.roomType,
      when: facts.checkIn && facts.checkOut ? `${facts.checkIn} → ${facts.checkOut}` : null,
      facts: offerFactsLine(facts),
    };
  }
  const carriers = offerCarriers(facts);
  return {
    lead: carriers.length ? carriers.join(', ') : offer.title.split(':')[0],
    qualifier: offerRoute(facts),
    when: offerTimeLabel(facts),
    facts: offerFactsLine(facts),
  };
}

/** "20:05 → 20:05+1", from the vendor's own timestamps. */
export function offerTimeLabel(
  facts: Extract<OfferFacts, { kind: 'flight' }>,
): string | null {
  const first = facts.segments[0];
  const last = facts.segments[facts.segments.length - 1];
  const depart = clock(first?.departAt ?? null);
  const arrive = clock(last?.arriveAt ?? null);
  if (!depart) return arrive;
  if (!arrive) return depart;
  const shift = dayShift(first?.departAt ?? null, last?.arriveAt ?? null);
  return `${depart} → ${shift ? `${arrive}${shift}` : arrive}`;
}

export { offerDurationLabel };

/**
 * A vendor timestamp as a clock time. SerpApi sends "2026-11-02 08:00" and
 * FlightAPI sends ISO; anything else stays unparsed and unshown.
 */
function clock(value: string | null): string | null {
  if (!value) return null;
  const parsed = parse(value);
  if (!parsed) return null;
  return `${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}`;
}

/** "+1" when the arrival is another calendar day, only if both ends parsed. */
function dayShift(from: string | null, to: string | null): string | null {
  const start = from ? parse(from) : null;
  const end = to ? parse(to) : null;
  if (!start || !end) return null;
  const days = Math.round((startOfDay(end) - startOfDay(start)) / 86_400_000);
  return days > 0 ? `+${days}` : null;
}

function parse(value: string): Date | null {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
