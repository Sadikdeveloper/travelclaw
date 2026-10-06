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

function render(withOffer: OfferRecord, overrides: Partial<AgentTaskRecord> = {}): string {
  return renderToStaticMarkup(
    <AgentCard
      task={{ ...task, ...overrides, offers: [withOffer] }}
      holdingOfferId=""
      onHold={vi.fn()}
      onStopBrowser={vi.fn()}
    />,
  );
}

describe('provider offer card', () => {
  it('offers the hold ask only for a source that can confirm one', () => {
    const html = render(offer);

    expect(html).toContain('Ask provider to hold');
    expect(html).toContain('Offer · no hold confirmed');
    expect(html).toContain('EUR');
  });

  it('says a quote-only source cannot hold instead of showing a dead button', () => {
    const html = render({ ...offer, holdSupport: 'unsupported' });

    expect(html).not.toContain('Ask provider to hold');
    expect(html).toContain('does not hold them');
    expect(html).toContain('Nothing is purchased here.');
  });

  it('shows the reference only after the provider confirmed a hold', () => {
    const html = render({
      ...offer,
      hold: 'confirmed',
      holdRef: 'HOLD-9',
      holdSupport: 'provider',
    });

    expect(html).toContain('Hold confirmed by provider');
    expect(html).toContain('Reference HOLD-9');
    expect(html).not.toContain('Ask provider to hold');
  });

  it('lays the vendor facts out as a fare row instead of a sentence', () => {
    const html = render(offer);

    expect(html).toContain('Example Air');
    expect(html).toContain('LOS → LIS');
    expect(html).toContain('08:05 → 15:30');
    expect(html).toContain('Nonstop');
    expect(html).toContain('6 hr 25 min');
    expect(html).toContain('Flight options');
  });

  it('names a single connection in the words the vendor sent', () => {
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
    expect(html).toContain('20:05 → 23:50+1');
    expect(html).toContain('24 hr 0 min');
  });

  it('keeps the prose the provider sent when the source sent no facts', () => {
    const html = render({ ...offer, facts: null, detail: 'nonstop · Example Air' });

    expect(html).toContain('nonstop · Example Air');
    expect(html).not.toContain('6 hr 25 min');
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
