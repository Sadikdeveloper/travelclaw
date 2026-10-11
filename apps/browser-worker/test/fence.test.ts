import { describe, expect, it } from 'vitest';
import { bookingEligibilityOf, fenceHolds } from '../src/engine';

/**
 * The lease fence, tested as the pure decision it is.
 *
 * A fence is what lets a booking run be *revoked* rather than merely stopped: the
 * session carries the epoch and the expiry of the traveler's approval, and this
 * function is asked both by the worker before it acts and by the gateway after
 * every call. Both halves matter independently, so each gets its own case.
 */
describe('fenceHolds', () => {
  const expiresAt = 1_000_000;
  const fence = { epoch: 'epoch-a', expiresAt };

  it('holds for the epoch the session was opened under, before expiry', () => {
    expect(fenceHolds(fence, 'epoch-a', expiresAt - 1)).toBe(true);
    // The boundary is inclusive: the last millisecond of the approval is still it.
    expect(fenceHolds(fence, 'epoch-a', expiresAt)).toBe(true);
  });

  it('does not hold once the approval has expired', () => {
    expect(fenceHolds(fence, 'epoch-a', expiresAt + 1)).toBe(false);
  });

  it('does not hold for a different epoch, even a valid unexpired one', () => {
    // A newer approval is still valid on its own terms; it just is not the one
    // this run was authorized by. Accepting it would let a run continue under an
    // authorization the traveler never gave it.
    expect(fenceHolds(fence, 'epoch-b', expiresAt - 1)).toBe(false);
  });

  it('does not hold when there is no fence at all', () => {
    expect(fenceHolds(undefined, 'epoch-a', expiresAt - 1)).toBe(false);
  });

  it('does not hold when the caller presents no epoch', () => {
    expect(fenceHolds(fence, undefined, expiresAt - 1)).toBe(false);
  });

  it.each([
    { epoch: 'epoch-a', now: expiresAt - 1, holds: true, why: 'unchanged, in time' },
    { epoch: 'epoch-a', now: expiresAt + 1, holds: false, why: 'ran out of time' },
    { epoch: 'epoch-b', now: expiresAt - 1, holds: false, why: 'superseded' },
  ])('decides $why the same way both call sites need it to', ({ epoch, now, holds }) => {
    // The worker asks with the session's own epoch, so only expiry can fail it;
    // the gateway asks with the epoch it recorded at the start of the run, so a
    // substitution fails it too. One function, both questions.
    expect(fenceHolds(fence, fence.epoch, now)).toBe(now <= expiresAt);
    expect(fenceHolds(fence, epoch, now)).toBe(holds);
  });
});

/**
 * What an observation may say about the source's booking step.
 *
 * Every value is a statement about the page. The one that sounds strongest —
 * `reachable` — says only that this run was allowed to act on a passenger-details
 * step it could see, and it needs both the authorization and the sight of it.
 */
describe('bookingEligibilityOf', () => {
  it('reports no booking step when none was seen', () => {
    expect(
      bookingEligibilityOf({
        booking: false,
        sawBookingStep: false,
        sawReachableBookingControl: false,
      }),
    ).toBe('no_booking_step_seen');
  });

  it('reports a blocked step when the page has one this run may not reach', () => {
    expect(
      bookingEligibilityOf({
        booking: false,
        sawBookingStep: true,
        sawReachableBookingControl: false,
      }),
    ).toBe('booking_step_blocked');
  });

  it('reports reachable only with the authorization AND a control it could act on', () => {
    const authorized = { booking: true, sawBookingStep: true, sawReachableBookingControl: true };
    expect(bookingEligibilityOf(authorized)).toBe('booking_step_reachable');
    // Authorized but the page never showed a passenger field: nothing to reach.
    expect(
      bookingEligibilityOf({ ...authorized, sawReachableBookingControl: false }),
    ).toBe('booking_step_blocked');
    // A control it could act on, in a run that was never authorized: still blocked,
    // because `reachable` is a claim about what this session may do.
    expect(
      bookingEligibilityOf({ ...authorized, booking: false }),
    ).toBe('booking_step_blocked');
  });
});
