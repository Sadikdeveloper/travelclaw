import { describe, expect, it } from 'vitest';
import { REDACTION_MARK, containsRedactable, redactBrowserText } from '../src/redact';

/**
 * Redaction of browser-originated text.
 *
 * This is the boundary that makes the rest of the booking work acceptable: once a
 * worker can stand on a passenger-details page, the snapshot carries the
 * traveler's own contact details, and a confirmation page can carry a key. There
 * is deliberately no configuration that turns this off.
 */
describe('browser output redaction', () => {
  it('redacts an email address', () => {
    expect(redactBrowserText('Confirmation sent to ada.obi@example.com')).toBe(
      `Confirmation sent to ${REDACTION_MARK}`,
    );
  });

  it('redacts a card-length digit run, formatted or not', () => {
    expect(redactBrowserText('Card 5399100000000007 approved')).toContain(REDACTION_MARK);
    expect(redactBrowserText('5399 1000 0000 0007')).toContain(REDACTION_MARK);
    expect(redactBrowserText('5399-1000-0000-0007')).toContain(REDACTION_MARK);
  });

  it('redacts a phone number', () => {
    expect(redactBrowserText('Call +234 803 456 7890 for changes')).toContain(
      REDACTION_MARK,
    );
  });

  it('redacts a bearer token and an access token', () => {
    expect(redactBrowserText('Authorization: Bearer abcdef0123456789abcdef')).toContain(
      REDACTION_MARK,
    );
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
    expect(redactBrowserText(`token ${jwt}`)).toBe(`token ${REDACTION_MARK}`);
  });

  it('redacts a cloud or platform key', () => {
    expect(redactBrowserText('AKIAIOSFODNN7EXAMPLE')).toContain(REDACTION_MARK);
    expect(redactBrowserText('sk-live-abcdefghijklmnopqrstuvwx')).toContain(
      REDACTION_MARK,
    );
    expect(redactBrowserText('ghp_abcdefghijklmnopqrstuvwxyz0123')).toContain(
      REDACTION_MARK,
    );
  });

  it('redacts a private key block whole', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----';
    expect(redactBrowserText(`before ${pem} after`)).toBe(
      `before ${REDACTION_MARK} after`,
    );
  });

  it('leaves ordinary fare text alone', () => {
    // The bias is toward over-redaction, but a fare page has to survive: prices,
    // dates, times, flight numbers and durations are what the desk is for.
    for (const text of [
      'Lagos to Dubai NGN 480,000 one adult taxes included',
      'Departs 2026-11-02 at 08:00, arrives 15:30',
      'Flight EK 784, 1 stop, 9h 45m total',
      'Rano Air R4 2033 from ₦310,970',
      'Baggage 23kg, seat 12A, gate B4',
      'Rating 4.6 from 1,284 reviews',
    ]) {
      expect(redactBrowserText(text), text).toBe(text);
    }
  });

  it('is idempotent', () => {
    const once = redactBrowserText('mail ada@example.com card 5399100000000007');
    expect(redactBrowserText(once)).toBe(once);
  });

  it('reports whether a string held something redactable', () => {
    expect(containsRedactable('ada@example.com')).toBe(true);
    expect(containsRedactable('NGN 480,000')).toBe(false);
    expect(containsRedactable('')).toBe(false);
  });

  it('handles an empty and an unchanged string without inventing content', () => {
    expect(redactBrowserText('')).toBe('');
    expect(redactBrowserText('Search flights')).toBe('Search flights');
  });
});
