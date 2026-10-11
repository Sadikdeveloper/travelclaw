import { describe, expect, it } from 'vitest';
import {
  admitControl,
  controlTier,
  type ControlFacts,
  type SessionPolicy,
} from '../src/engine';

/**
 * The control gate, tested as the policy it is.
 *
 * These run the same `admitControl` the engine calls from both of its call sites
 * — the snapshot, which decides what a session is offered at all, and the action
 * handler, which decides what it may touch — so the boundary is exercised
 * directly rather than only through a browser. Chromium could not be launched in
 * this sandbox (the only reachable Chromium build needs NSS symbols the
 * available libraries do not provide, and no Debian mirror was reachable), so
 * this file is the coverage that stands in for the fixture run on the gate.
 */

const SEARCH_ONLY: SessionPolicy = {
  siteHasBookingScope: false,
  bookingConfirmed: false,
};
/** Operator granted the scope; the traveler has not confirmed this run. */
const SCOPED_UNCONFIRMED: SessionPolicy = {
  siteHasBookingScope: true,
  bookingConfirmed: false,
};
/** Both halves: the operator's scope and the traveler's recorded go-ahead. */
const CONFIRMED: SessionPolicy = {
  siteHasBookingScope: true,
  bookingConfirmed: true,
};

const control = (label: string, extra: Partial<ControlFacts> = {}): ControlFacts => ({
  label,
  type: 'text',
  sensitive: false,
  name: '',
  ...extra,
});

describe('control tiers', () => {
  it('puts payment, credential and identity controls in the closed tier', () => {
    for (const label of [
      'Card number',
      'CVV',
      'Payment',
      'Pay now',
      'Checkout',
      'Total due',
      'Password',
      'One-time code',
      'Passport number',
      'National ID',
      'Sign in',
      'Accept all cookies',
    ]) {
      expect(controlTier(control(label)), label).toBe('never');
    }
  });

  it('puts a passenger-details step in the bookable tier', () => {
    for (const label of [
      'First name',
      'Last name',
      'Passenger name',
      'Email',
      'Contact email',
      'Phone',
      'Mobile number',
      'Book now',
      'Confirm booking',
    ]) {
      expect(controlTier(control(label)), label).toBe('booking');
    }
  });

  it('leaves the ordinary search form alone', () => {
    for (const label of ['Origin', 'Destination', 'Date', 'Travelers', 'Currency']) {
      expect(controlTier(control(label)), label).toBe('search');
    }
  });

  it('classifies a payment field by its name even under an innocuous label', () => {
    // A label is page-controlled text. The name, id and autocomplete attributes
    // are read too, so renaming a card field does not move it into a fillable tier.
    expect(controlTier(control('Details', { name: 'cardNumber' }))).toBe('never');
    expect(controlTier(control('Details', { name: 'cc-exp' }))).toBe('never');
    expect(controlTier(control('Details', { sensitive: true }))).toBe('never');
  });

  it('refuses a mixed label rather than picking the permissive half', () => {
    // "Confirm booking and pay" matches both tiers. The closed one is tested
    // first, so an ambiguous control is never pressed.
    expect(controlTier(control('Confirm booking and pay'))).toBe('never');
    expect(admitControl(CONFIRMED, control('Confirm booking and pay')).admit).toBe(false);
  });
});

describe('admission policy', () => {
  it('lets a search session fill its own form', () => {
    expect(admitControl(SEARCH_ONLY, control('Origin')).admit).toBe(true);
    expect(admitControl(SEARCH_ONLY, control('Travelers')).admit).toBe(true);
  });

  it('refuses the payment tier for every session, including a confirmed booking', () => {
    for (const policy of [SEARCH_ONLY, SCOPED_UNCONFIRMED, CONFIRMED]) {
      const decision = admitControl(policy, control('Card number'));
      expect(decision.admit, JSON.stringify(policy)).toBe(false);
      if (!decision.admit) {
        expect(decision.reason).toBe('ambiguous_form');
        expect(decision.message).toMatch(/payment, credential, or identity/i);
      }
    }
  });

  it('refuses the closed input types regardless of label', () => {
    for (const type of ['password', 'file', 'hidden']) {
      expect(admitControl(CONFIRMED, control('Origin', { type })).admit).toBe(false);
    }
  });

  it('names the operator when a site has no booking scope', () => {
    const decision = admitControl(SEARCH_ONLY, control('Email'));
    expect(decision.admit).toBe(false);
    if (decision.admit) return;
    expect(decision.reason).toBe('confirmation_required');
    expect(decision.message).toMatch(/search only/);
    expect(decision.message).toMatch(/operator can grant/i);
  });

  it('names the traveler when a scope exists but this run was not confirmed', () => {
    const decision = admitControl(SCOPED_UNCONFIRMED, control('First name'));
    expect(decision.admit).toBe(false);
    if (decision.admit) return;
    expect(decision.reason).toBe('confirmation_required');
    expect(decision.message).toMatch(/explicit go-ahead/);
    expect(decision.message).toMatch(/payment always stays with you/i);
  });

  it('admits a passenger field only when both halves are present', () => {
    expect(admitControl(CONFIRMED, control('First name')).admit).toBe(true);
    expect(admitControl(CONFIRMED, control('Email', { type: 'email' })).admit).toBe(true);
    expect(admitControl(CONFIRMED, control('Phone', { type: 'tel' })).admit).toBe(true);
  });

  it('treats a missing half as the whole refusal: a confirmation cannot substitute for scope', () => {
    // The traveler saying yes does not grant a site the operator never scoped.
    const decision = admitControl(
      { siteHasBookingScope: false, bookingConfirmed: true },
      control('First name'),
    );
    expect(decision.admit).toBe(false);
    if (decision.admit) return;
    expect(decision.message).toMatch(/search only/);
  });

  it('refuses a control that changed since the snapshot', () => {
    const decision = admitControl(CONFIRMED, control('Confirm booking'), 'Book now');
    expect(decision.admit).toBe(false);
    if (decision.admit) return;
    expect(decision.reason).toBe('ambiguous_form');
    expect(decision.message).toMatch(/changed since the snapshot/i);
  });

  it('checks the label before the tier, so a swap is caught even for a search field', () => {
    const decision = admitControl(SEARCH_ONLY, control('Card number'), 'Origin');
    expect(decision.admit).toBe(false);
    if (decision.admit) return;
    expect(decision.reason).toBe('ambiguous_form');
    expect(decision.message).toMatch(/changed since the snapshot/i);
  });
});
