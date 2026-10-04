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
      bookingEligibility: 'not_bookable',
      evidence: '<script>steal()</script> Lagos to Dubai NGN 480,000',
    },
  ],
};
describe('browser research card', () => {
  it('shows provenance and warning, escapes page evidence, and has no hold control', () => {
    const html = renderToStaticMarkup(<BrowserResearch run={run} onStop={vi.fn()} />);
    expect(html).toContain('Page observed · not bookable here');
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
        <BrowserResearch run={{ ...run, status: 'running' }} onStop={vi.fn()} />,
      ),
    ).toContain('Stop browser search');
    const html = renderToStaticMarkup(
      <BrowserResearch
        run={{ ...run, status: 'handoff', reason: 'verification' }}
        onStop={vi.fn()}
      />,
    );
    expect(html).toContain('not the worker session');
    expect(html).toContain('verification');
    expect(html).not.toContain('Stop browser search');
  });
  it('does not render unsafe source link schemes', () => {
    const html = renderToStaticMarkup(
      <BrowserResearch
        run={{ ...run, sourceUrl: 'javascript:alert(1)' }}
        onStop={vi.fn()}
      />,
    );
    expect(html).not.toContain('href="javascript:');
  });
});
