import { describe, expect, it } from 'vitest';
import type { OfferFlightFacts } from '@travelclaw/shared';
import { offerDepartureDate, offerTimeLabel } from './offerDisplay';

describe('flight offer date and time labels', () => {
  it('keeps the provider’s local wall time and departure date when timestamps have offsets', () => {
    const facts: OfferFlightFacts = {
      kind: 'flight',
      segments: [
        {
          from: 'LOS',
          to: 'LIS',
          departAt: '2026-11-02T23:10:00-05:00',
          arriveAt: '2026-11-03T08:15:00+01:00',
          carrier: 'Example Air',
        },
      ],
      stops: 0,
      durationMinutes: 555,
      stopNames: [],
    };

    expect(offerDepartureDate(facts)).toBe('Mon, Nov 2');
    expect(offerTimeLabel(facts)).toBe('23:10 → 08:15+1');
  });

  it('labels the actual provider departure date for a timestamp without a timezone', () => {
    const facts: OfferFlightFacts = {
      kind: 'flight',
      segments: [
        {
          from: 'LOS',
          to: 'LIS',
          departAt: '2026-11-02 08:05',
          arriveAt: '2026-11-02 15:30',
          carrier: 'Example Air',
        },
      ],
      stops: 0,
      durationMinutes: 445,
      stopNames: [],
    };

    expect(offerDepartureDate(facts)).toBe('Mon, Nov 2');
    expect(offerTimeLabel(facts)).toBe('08:05 → 15:30');
  });
});
