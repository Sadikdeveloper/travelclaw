import { describe, expect, it } from 'vitest';
import { dateMatchesStated, groundedField, parseDateKey } from '../src/engine';

/**
 * Date grounding: the page's notation and the traveler's notation differ.
 *
 * A real booking flow made this concrete — ibomair.com's form holds `26.10.2026`
 * while the traveler asks for "26 October 2026". Plain string grounding would
 * refuse the fill, so the date slots additionally accept a value whose calendar
 * day equals a date the traveler stated, in any recognized notation.
 *
 * This is translation, not guessing: a different day, or a day nobody stated,
 * must still be refused. Every case below is one side of that line.
 */
describe('parseDateKey', () => {
  it.each([
    ['2026-10-26', '2026-10-26'],
    ['26.10.2026', '2026-10-26'],
    ['26/10/2026', '2026-10-26'],
    ['26-10-2026', '2026-10-26'],
    ['26 Oct 2026', '2026-10-26'],
    ['26 October 2026', '2026-10-26'],
    ['October 26, 2026', '2026-10-26'],
    ['Oct 26 2026', '2026-10-26'],
    ['1.2.2026', '2026-02-01'],
  ])('parses %s as %s', (input, key) => {
    expect(parseDateKey(input)).toBe(key);
  });

  it.each([
    '26.13.2026', // month 13
    '32.10.2026', // day 32
    'not a date',
    '2026',
    '26 October', // no year
    '',
  ])('rejects %s', (input) => {
    expect(parseDateKey(input)).toBeNull();
  });
});

describe('dateMatchesStated', () => {
  const request = 'Book a flight from Abuja to Lagos on 26 October 2026, returning same day.';

  it('accepts the page notation of a stated date', () => {
    expect(dateMatchesStated('26.10.2026', request)).toBe(true);
    expect(dateMatchesStated('2026-10-26', request)).toBe(true);
    expect(dateMatchesStated('26/10/2026', request)).toBe(true);
  });

  it('refuses a different day even in a valid notation', () => {
    expect(dateMatchesStated('27.10.2026', request)).toBe(false);
    expect(dateMatchesStated('26.11.2026', request)).toBe(false);
  });

  it('refuses a date nobody stated', () => {
    expect(dateMatchesStated('02.02.2027', request)).toBe(false);
  });

  it('finds a stated date written like the page too', () => {
    expect(dateMatchesStated('26 October 2026', 'Fly on 26.10.2026 please.')).toBe(true);
  });
});

describe('groundedField date slots', () => {
  const request = 'Abuja to Lagos, departing 26 October 2026, one adult.';

  it('fills a date slot from the page notation of the stated date', () => {
    expect(groundedField('Departure date', '26.10.2026', request)).toBe(true);
    expect(groundedField('Return date', '26.10.2026', request)).toBe(true);
    expect(groundedField('Check-in', '2026-10-26', request)).toBe(true);
  });

  it('still accepts the exact stated string', () => {
    expect(groundedField('Departure date', '26 October 2026', request)).toBe(true);
  });

  it('refuses an unstated day in a date slot', () => {
    expect(groundedField('Departure date', '27.10.2026', request)).toBe(false);
  });

  it('does not apply date translation to non-date slots', () => {
    // A city or name slot must not start accepting arbitrary date strings.
    expect(groundedField('Origin', '26.10.2026', request)).toBe(false);
    expect(groundedField('First Name', '26.10.2026', request)).toBe(false);
  });

  it('keeps non-date grounding unchanged for date-shaped values in text slots', () => {
    // Outside a date slot, a dotted string is grounded only if literally stated.
    expect(groundedField('Promo code', '26.10.2026', request)).toBe(false);
  });
});
