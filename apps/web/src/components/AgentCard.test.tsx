import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentTaskRecord, OfferRecord } from '@travelclaw/shared';
import { AgentCard } from './AgentCard';

const offer: OfferRecord = {
  id: 'offer-1',
  sessionId: 's1',
  taskId: 't1',
  kind: 'flight',
  provider: 'SerpApi Google Flights and Hotels',
  providerOfferId: 'serpapi-flight-EX1@2026-11-0208:00#abc',
  retrievedAt: '2026-10-06T09:00:00Z',
  currency: 'EUR',
  totalAmount: 620.5,
  title: 'Example Air: LOS → LIS',
  detail: 'nonstop · Example Air',
  facts: {
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
    durationMinutes: 385,
    stopNames: [],
  },
  bookingUrl: null,
  hold: 'none',
  holdSupport: 'provider',
  holdRef: null,
  holdExpiresAt: null,
  holdNote: null,
  createdAt: '2026-10-06T09:00:00Z',
  updatedAt: '2026-10-06T09:00:00Z',
};

const task: AgentTaskRecord = {
  id: 't1',
  sessionId: 's1',
  messageId: 'm1',
  kind: 'flight',
  agentName: 'Flight desk',
  status: 'completed',
  summary: 'Flight desk finished a brief for Lagos to Lisbon.',
  pass: 1,
  offers: [offer],
  createdAt: '2026-10-06T09:00:00Z',
  updatedAt: '2026-10-06T09:00:00Z',
};

function render(
  withOffer: OfferRecord,
  overrides: Partial<AgentTaskRecord> = {},
  selectedOfferId: string | null = null,
): string {
  return renderToStaticMarkup(
    <AgentCard
      task={{ ...task, ...overrides, offers: [withOffer] }}
      holdingOfferId=""
      selectedOfferId={selectedOfferId}
      onSelectOffer={vi.fn()}
      onHold={vi.fn()}
      onStopBrowser={vi.fn()}
    />,
  );
}

describe('provider offer card', () => {
  it('shows a quote and offers a reservation request only when the source supports one', () => {
    const html = render(offer);

    expect(html).toContain('Request provider reservation');
    expect(html).toContain('Quote · no hold confirmed');
    expect(html).toContain('Quotes are not reservations.');
    expect(html).toContain('€620.50');
  });

  it('clearly labels a quote-only source without showing a hold action', () => {
    const html = render({ ...offer, holdSupport: 'unsupported' });

    expect(html).not.toContain('Request provider reservation');
    expect(html).toContain('No hold available');
    expect(html).toContain('Quotes are not reservations.');
  });

  it('shows the hold reference only after the provider confirmed it', () => {
    const html = render(
      {
        ...offer,
        hold: 'confirmed',
        holdRef: 'HOLD-9',
        holdExpiresAt: '2026-10-08T10:00:00Z',
        holdSupport: 'provider',
      },
      {},
      offer.id,
    );

    expect(html).toContain('Provider reservation confirmed');
    expect(html).toContain('Provider reference HOLD-9');
    expect(html).toContain('Reservation hold expires 2026-10-08T10:00:00Z.');
    expect(html).toContain('TravelClaw has not taken payment.');
    expect(html).toContain('The provider confirmed this reservation hold.');
    expect(html).not.toContain('Request provider reservation');
  });

  it('lays vendor facts out as a date-labelled fare row', () => {
    const html = render(offer);

    expect(html).toContain('Example Air');
    expect(html).toContain('LOS → LIS');
    expect(html).toContain('Nov 2');
    expect(html).toContain('08:05');
    expect(html).toContain('15:30');
    expect(html).toContain('Nonstop');
    expect(html).toContain('6 hr 25 min');
    expect(html).toContain('Flight options');
  });

  it('names a connection and next-day arrival using the vendor facts', () => {
    const html = render({
      ...offer,
      facts: {
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
            arriveAt: '2026-10-13 23:50',
            carrier: 'Air Peace',
          },
        ],
        stops: 1,
        durationMinutes: 1440,
        stopNames: ['Lagos'],
      },
    });

    expect(html).toContain('1 stop');
    expect(html).toContain('via Lagos');
    expect(html).toContain('20:05');
    expect(html).toContain('23:50+1');
    expect(html).toContain('Next day');
    expect(html).toContain('24 hr 0 min');
  });

  it('keeps provider prose when the source sent no structured facts', () => {
    const html = render({ ...offer, facts: null, detail: 'nonstop · Example Air' });

    expect(html).toContain('nonstop · Example Air');
    expect(html).not.toContain('6 hr 25 min');
  });

  it('shows the selected quote and a clearly labelled fallback booking search', () => {
    const html = render(offer, {}, offer.id);

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Flight selected');
    expect(html).toContain('Search the web for options');
    expect(html).toContain('https://www.google.com/search?q=');
    expect(html).toContain('opens a general search for booking options.');
    expect(html).toContain('TravelClaw does not process payment or collect card details.');
    expect(html).not.toContain('is not a ticket or completed booking');
  });

  it('hands off to a supplied provider URL and keeps booking status honest', () => {
    const html = render(
      { ...offer, bookingUrl: 'https://book.example-air.test/checkout/offer-1' },
      {},
      offer.id,
    );

    expect(html).toContain('href="https://book.example-air.test/checkout/offer-1"');
    expect(html).toContain('Continue booking with provider');
    expect(html).not.toContain('Search the web for options');
    expect(html).toContain('This offer is not reserved yet.');
    expect(html).toContain('may prefill the offer.');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('reads a stay as a stay: nights, window, and the rating that arrived', () => {
    const html = render(
      {
        ...offer,
        kind: 'stay',
        title: 'Hotel Avenida Palace',
        facts: {
          kind: 'stay',
          name: 'Hotel Avenida Palace',
          roomType: 'Double room',
          nights: 3,
          checkIn: '2026-11-02',
          checkOut: '2026-11-05',
          rating: 8.8,
        },
      },
      { kind: 'stay', agentName: 'Stay desk' },
    );

    expect(html).toContain('Places to stay');
    expect(html).toContain('Hotel Avenida Palace');
    expect(html).toContain('Double room');
    expect(html).toContain('2026-11-02 → 2026-11-05');
    expect(html).toContain('3 nights');
    expect(html).toContain('Rated 8.8');
  });
});
