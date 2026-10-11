import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrowserRunRecord } from '@travelclaw/shared';
import { BrowserResearch } from './BrowserResearch';
const run: BrowserRunRecord = {
  status: 'observed',
  message: 'Page observed, not booked.',
  sourceUrl: 'https://airline.example/search',
  steps: [],
  observations: [
    {
      kind: 'browser_observation',
      travelKind: 'flight',
      sourceName: 'Fixture Air',
      sourceUrl: 'https://airline.example/search',
      observedAt: '2026-10-04T12:00:00Z',
      snapshotId: 'snap-1',
      title: 'Lagos to Dubai',
      displayedPrice: '480,000',
      displayedCurrency: 'NGN',
      visibleConditions: [],
      verification: 'page_observed',
      bookingEligibility: 'no_booking_step_seen',
      evidence: '<script>steal()</script> Lagos to Dubai NGN 480,000',
    },
  ],
};
const props = {
  onStop: vi.fn(),
  onApproveBooking: vi.fn(),
  onRevokeBooking: vi.fn(),
};
describe('browser research card', () => {
  it('shows provenance and warning, escapes page evidence, and has no hold control', () => {
    const html = renderToStaticMarkup(<BrowserResearch {...props} run={run} />);
    expect(html).toContain('Page observed · no booking step seen here');
    expect(html).toContain('Fixture Air');
    expect(html).toContain('NGN');
    expect(html).toContain('https://airline.example/search');
    expect(html).toContain('No conditions captured');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('Ask provider to hold');
  });
  it('offers Stop while running and an honest source-link handoff', () => {
    expect(
      renderToStaticMarkup(
        <BrowserResearch {...props} run={{ ...run, status: 'running' }} />,
      ),
    ).toContain('Stop browser search');
    const html = renderToStaticMarkup(
      <BrowserResearch
        {...props}
        run={{ ...run, status: 'handoff', reason: 'verification' }}
      />,
    );
    expect(html).toContain('not the worker session');
    expect(html).toContain('verification');
    expect(html).not.toContain('Stop browser search');
  });
  it('offers the fill approval only when the worker stopped at a passenger step', () => {
    const asking = renderToStaticMarkup(
      <BrowserResearch
        {...props}
        run={{
          ...run,
          status: 'handoff',
          reason: 'confirmation_required',
          siteId: 'rano',
          siteName: 'Rano Air',
        }}
      />,
    );
    expect(asking).toContain('Approve and fill my details');
    expect(asking).toContain('Rano Air');
    expect(asking).toContain('TravelClaw never takes payment');
    // A different handoff reason is not an approval moment, and a run with no
    // site recorded has nothing to name on the card.
    expect(
      renderToStaticMarkup(
        <BrowserResearch
          {...props}
          run={{ ...run, status: 'handoff', reason: 'sign_in' }}
        />,
      ),
    ).not.toContain('Approve and fill my details');
    expect(
      renderToStaticMarkup(
        <BrowserResearch
          {...props}
          run={{ ...run, status: 'handoff', reason: 'confirmation_required' }}
        />,
      ),
    ).not.toContain('Approve and fill my details');
  });
  it('offers a withdrawal while an approved run is live, and not otherwise', () => {
    expect(
      renderToStaticMarkup(
        <BrowserResearch {...props} run={{ ...run, status: 'running', booking: true }} />,
      ),
    ).toContain('Withdraw approval and stop');
    expect(
      renderToStaticMarkup(
        <BrowserResearch {...props} run={{ ...run, status: 'running' }} />,
      ),
    ).not.toContain('Withdraw approval and stop');
    expect(
      renderToStaticMarkup(<BrowserResearch {...props} run={{ ...run, booking: true }} />),
    ).not.toContain('Withdraw approval and stop');
  });
  it('says what the page exposes without claiming an outcome', () => {
    for (const [value, copy] of [
      ['booking_step_blocked', 'a booking step exists here but this run is not authorized'],
      [
        'booking_step_reachable',
        'authorized to reach a booking step. Nothing was submitted',
      ],
    ] as const) {
      const html = renderToStaticMarkup(
        <BrowserResearch
          {...props}
          run={{
            ...run,
            observations: run.observations.map((o) => ({
              ...o,
              bookingEligibility: value,
            })),
          }}
        />,
      );
      expect(html).toContain(copy);
    }
  });
  it('does not render unsafe source link schemes', () => {
    const html = renderToStaticMarkup(
      <BrowserResearch {...props} run={{ ...run, sourceUrl: 'javascript:alert(1)' }} />,
    );
    expect(html).not.toContain('href="javascript:');
  });
});
