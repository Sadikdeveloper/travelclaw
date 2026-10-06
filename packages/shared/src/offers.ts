import type { OfferFacts, OfferFlightFacts } from './types';

/**
 * The shared wording for an offer's vendor facts, so the desk's brief and the
 * chat card describe the same offer the same way. Every value is the vendor's own
 * or arithmetic on it; a fact the vendor did not send stays absent.
 */

/** "KAN → ABV" — the endpoints of the itinerary, not the stopovers. */
export function offerRoute(facts: OfferFlightFacts): string | null {
  const first = facts.segments[0];
  const last = facts.segments[facts.segments.length - 1];
  if (!first?.from || !last?.to) return null;
  return `${first.from} → ${last.to}`;
}

/** Minutes as a duration a fare row reads: "24 hr 0 min". */
export function offerDurationLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** "Nonstop", "1 stop" or "2 stops", with the named stop only when it is the one stop. */
export function offerStopsLabel(facts: OfferFlightFacts): string | null {
  if (facts.stops === null) return null;
  if (facts.stops === 0) return 'Nonstop';
  const stops = `${facts.stops} stop${facts.stops === 1 ? '' : 's'}`;
  return facts.stops === 1 && facts.stopNames.length === 1
    ? `${stops} · via ${facts.stopNames[0]}`
    : stops;
}

/** Every carrier the vendor named, in the order the legs fly them. */
export function offerCarriers(facts: OfferFlightFacts): string[] {
  return [
    ...new Set(
      facts.segments
        .map((segment) => segment.carrier)
        .filter((carrier): carrier is string => Boolean(carrier)),
    ),
  ];
}

/** The line under the route: stops, duration, or nights and rating for a stay. */
export function offerFactsLine(facts: OfferFacts): string | null {
  if (facts.kind === 'stay') {
    const line = [
      facts.nights ? `${facts.nights} night${facts.nights === 1 ? '' : 's'}` : null,
      facts.rating !== null ? `Rated ${facts.rating}` : null,
    ].filter(Boolean);
    return line.length ? line.join(' · ') : null;
  }
  const line = [
    offerStopsLabel(facts),
    facts.durationMinutes !== null && facts.durationMinutes > 0
      ? offerDurationLabel(facts.durationMinutes)
      : null,
  ].filter(Boolean);
  return line.length ? line.join(' · ') : null;
}
