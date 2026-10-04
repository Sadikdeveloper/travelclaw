import { describe, expect, it } from 'vitest';
import { browserActionSchema, browserObservationSchema } from './browser';

const observation = {
  kind: 'browser_observation',
  travelKind: 'flight',
  sourceName: 'Fixture airline',
  sourceUrl: 'https://airline.example/search',
  observedAt: '2026-10-04T12:30:00Z',
  snapshotId: 'snapshot-1',
  title: 'Lagos to Dubai',
  displayedPrice: '$ 480.00',
  displayedCurrency: '$',
  visibleConditions: ['One adult; taxes included; baggage extra'],
  verification: 'page_observed',
  bookingEligibility: 'not_bookable',
};

describe('browser wire contracts', () => {
  it('retains literal page price, currency and visible conditions without inventing an offer', () => {
    expect(browserObservationSchema.parse(observation)).toEqual(observation);
    expect(
      browserObservationSchema.parse({ ...observation, visibleConditions: [] })
        .visibleConditions,
    ).toEqual([]);
  });

  it.each([
    'sourceName',
    'sourceUrl',
    'observedAt',
    'snapshotId',
    'displayedCurrency',
    'visibleConditions',
  ])('requires observation provenance: %s', (key) => {
    const value: Record<string, unknown> = { ...observation };
    delete value[key];
    expect(browserObservationSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    { verification: 'api_confirmed' },
    { bookingEligibility: 'holdable' },
    { providerOfferId: 'provider-123' },
    { holdRef: 'confirmed-123' },
    { observedAt: 'sometime today' },
    { displayedCurrency: '' },
  ])('rejects provider-shaped claims or missing provenance: %j', (patch) => {
    expect(browserObservationSchema.safeParse({ ...observation, ...patch }).success).toBe(
      false,
    );
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:secret@airline.example',
    'not a url',
  ])('rejects invalid URL syntax or embedded credentials: %s', (url) => {
    expect(browserActionSchema.safeParse({ action: 'navigate', url }).success).toBe(false);
    expect(
      browserObservationSchema.safeParse({ ...observation, sourceUrl: url }).success,
    ).toBe(false);
  });

  it.each([
    { action: 'navigate', url: 'https://airline.example/search' },
    { action: 'inspect' },
    { action: 'fill', snapshotId: 's1', elementId: 'e1', value: 'Lagos' },
    { action: 'select', snapshotId: 's1', elementId: 'e2', value: '1' },
    { action: 'click', snapshotId: 's1', elementId: 'e3' },
    {
      action: 'handoff',
      reason: 'verification',
      message: 'The site requires human verification.',
    },
    { action: 'stop' },
  ])('accepts a bounded action shape: %j', (action) => {
    expect(browserActionSchema.parse(action)).toEqual(action);
  });

  it.each([
    { action: 'evaluate', script: 'document.cookie' },
    { action: 'fill', selector: '#password', value: 'secret' },
    { action: 'click', elementId: 'e1' },
    { action: 'click', snapshotId: 's1', elementId: 'e1', userId: 'another-user' },
    { action: 'inspect', sessionId: 'another-session' },
    { action: 'stop', script: 'ignored extra field' },
    { action: 'fill', snapshotId: 's1', elementId: 'e1', value: 'a'.repeat(501) },
  ])(
    'rejects arbitrary code, selectors, owner overrides and unbounded inputs: %j',
    (action) => {
      expect(browserActionSchema.safeParse(action).success).toBe(false);
    },
  );
});
