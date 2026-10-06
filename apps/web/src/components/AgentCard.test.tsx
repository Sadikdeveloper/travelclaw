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

describe('provider offer card', () => {
  it('offers the hold ask only for a source that can confirm one', () => {
    const html = renderToStaticMarkup(
      <AgentCard task={task} holdingOfferId="" onHold={vi.fn()} onStopBrowser={vi.fn()} />,
    );

    expect(html).toContain('Ask provider to hold');
    expect(html).toContain('Offer · no hold confirmed');
    expect(html).toContain('EUR');
  });

  it('says a quote-only source cannot hold instead of showing a dead button', () => {
    const html = renderToStaticMarkup(
      <AgentCard
        task={{ ...task, offers: [{ ...offer, holdSupport: 'unsupported' }] }}
        holdingOfferId=""
        onHold={vi.fn()}
        onStopBrowser={vi.fn()}
      />,
    );

    expect(html).not.toContain('Ask provider to hold');
    expect(html).toContain('does not hold them');
    expect(html).toContain('Nothing is purchased here.');
  });

  it('shows the reference only after the provider confirmed a hold', () => {
    const html = renderToStaticMarkup(
      <AgentCard
        task={{
          ...task,
          offers: [
            { ...offer, hold: 'confirmed', holdRef: 'HOLD-9', holdSupport: 'provider' },
          ],
        }}
        holdingOfferId=""
        onHold={vi.fn()}
        onStopBrowser={vi.fn()}
      />,
    );

    expect(html).toContain('Hold confirmed by provider');
    expect(html).toContain('Reference HOLD-9');
    expect(html).not.toContain('Ask provider to hold');
  });
});
