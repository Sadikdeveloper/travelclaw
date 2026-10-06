import { describe, expect, it } from 'vitest';
import {
  offerCarriers,
  offerDurationLabel,
  offerFactsLine,
  offerRoute,
  offerStopsLabel,
} from './offers';
import type { OfferFlightFacts, OfferStayFacts } from './types';

const stopover: OfferFlightFacts = {
  kind: 'flight',
  segments: [
    {
      from: 'KAN',
      to: 'LOS',
      departAt: '2026-10-12 20:05',
      arriveAt: '2026-10-12 21:20',
      carrier: 'Air Peace',
    },
    {
      from: 'LOS',
      to: 'ABV',
      departAt: '2026-10-12 22:10',
      arriveAt: '2026-10-13 20:05',
      carrier: 'Air Peace',
    },
  ],
  stops: 1,
  durationMinutes: 1440,
  stopNames: ['Lagos'],
};

describe('offer facts wording', () => {
  it('describes the endpoints, not the stopover', () => {
    expect(offerRoute(stopover)).toBe('KAN → ABV');
  });

  it('names the stop in words the vendor sent', () => {
    expect(offerStopsLabel(stopover)).toBe('1 stop · via Lagos');
  });

  it('keeps a count of two stops and no name that cannot be attributed', () => {
    expect(offerStopsLabel({ ...stopover, stops: 2, stopNames: [] })).toBe('2 stops');
  });

  it('says nothing about stops when the vendor did not count them', () => {
    expect(offerStopsLabel({ ...stopover, stops: null, stopNames: [] })).toBeNull();
  });

  it('reads one leg as nonstop', () => {
    expect(
      offerStopsLabel({
        ...stopover,
        segments: [stopover.segments[0]],
        stops: 0,
        stopNames: [],
      }),
    ).toBe('Nonstop');
  });

  it('pairs stops with the vendor duration', () => {
    expect(offerFactsLine(stopover)).toBe('1 stop · via Lagos · 24 hr 0 min');
    expect(offerDurationLabel(1440)).toBe('24 hr 0 min');
    expect(offerDurationLabel(705)).toBe('11 hr 45 min');
  });

  it('lists each carrier once, in the order flown', () => {
    expect(offerCarriers(stopover)).toEqual(['Air Peace']);
    expect(
      offerCarriers({
        ...stopover,
        segments: [
          { ...stopover.segments[0], carrier: 'Air Peace' },
          { ...stopover.segments[1], carrier: 'Ethiopian' },
        ],
      }),
    ).toEqual(['Air Peace', 'Ethiopian']);
  });

  it('reads a stay as nights and the vendor rating', () => {
    const stay: OfferStayFacts = {
      kind: 'stay',
      name: 'Transcorp Hilton Abuja',
      roomType: 'King room',
      nights: 3,
      checkIn: '2026-10-12',
      checkOut: '2026-10-15',
      rating: 8.6,
    };
    expect(offerFactsLine(stay)).toBe('3 nights · Rated 8.6');
    expect(offerFactsLine({ ...stay, nights: 1, rating: null })).toBe('1 night');
    expect(offerFactsLine({ ...stay, nights: null, rating: null })).toBeNull();
  });
});
