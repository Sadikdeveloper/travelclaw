import { describe, expect, it } from 'vitest';
import { permittedUrl, pinnedTransport, publicAddress } from '../src/network';
import { grounded, groundedField } from '../src/engine';
import type { BrowserSite } from '@travelclaw/shared';
const site: BrowserSite = {
  id: 'fixture',
  name: 'Fixture',
  kind: 'flight',
  startUrl: 'https://search.example/',
  origins: ['https://search.example'],
  searchPostPaths: ['/search'],
};
describe('browser egress policy', () => {
  it.each([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '168.63.129.16',
    '::ffff:168.63.129.16',
    'fc00::1',
    'fe80::1',
    '0.0.0.0',
    '224.0.0.1',
    '100.64.0.1',
    '2001:db8::1',
    'not an ip',
  ])('rejects non-public address %s', (ip) => expect(publicAddress(ip)).toBe(false));
  it('accepts ordinary public IP addresses', () => {
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it.each([
    'file:///etc/passwd',
    'http://127.0.0.1/',
    'https://search.example.evil.test/',
    'https://user:pass@search.example/',
    'https://search.example:8443/',
    'https://search.example/checkout',
    'https://search.example/%70ayment',
    'javascript:alert(1)',
  ])('rejects forbidden destination %s', (url) =>
    expect(() => permittedUrl(url, site)).toThrow(),
  );
  it('allows only explicitly authorized search writes', () => {
    expect(permittedUrl('https://search.example/search', site, 'POST').pathname).toBe(
      '/search',
    );
    expect(() => permittedUrl('https://search.example/other', site, 'POST')).toThrow();
    expect(() => permittedUrl('https://search.example/search', site, 'DELETE')).toThrow();
  });
  it('keeps a search-only session off a booking path', () => {
    // The default site has no booking scope, so `reserve` stays closed and a
    // booking POST is refused even if the path were somehow named.
    expect(() => permittedUrl('https://search.example/reserve', site)).toThrow();
    expect(() => permittedUrl('https://search.example/reservation', site)).toThrow();
    expect(() => permittedUrl('https://search.example/reserve', site, 'POST')).toThrow();
  });

  it('opens a booking path only for a session that was authorized for booking', () => {
    const scoped: BrowserSite = { ...site, bookingPaths: ['/reserve'] };
    // Same site, same URL: the session's authorization is what differs.
    expect(() => permittedUrl('https://search.example/reserve', scoped)).toThrow();
    expect(
      permittedUrl('https://search.example/reserve', scoped, 'GET', { booking: true })
        .pathname,
    ).toBe('/reserve');
    // Only the exact listed path. A step the operator did not list stays closed.
    expect(() =>
      permittedUrl('https://search.example/reserve/step2', scoped, 'GET', {
        booking: true,
      }),
    ).toThrow();
  });

  it.each([
    '/checkout',
    '/payment',
    '/purchase',
    '/creditcard',
    '/login',
    '/password',
    '/authorization',
    '/reserve/payment',
    '/booking?next=/checkout',
  ])('refuses %s even for an authorized booking session', (path) => {
    // A booking scope grants the passenger-details step. Money and credentials
    // are refused regardless of what an operator listed, which is what makes
    // granting the scope safe at all.
    const scoped: BrowserSite = {
      ...site,
      bookingPaths: ['/reserve', '/booking', path],
    };
    expect(() =>
      permittedUrl(`https://search.example${path}`, scoped, 'GET', { booking: true }),
    ).toThrow();
    expect(() =>
      permittedUrl(`https://search.example${path}`, scoped, 'POST', { booking: true }),
    ).toThrow();
  });

  it('lets a booking POST through on a listed booking path only', () => {
    // Submitting the passenger form is the write a booking scope exists to allow.
    const scoped: BrowserSite = { ...site, bookingPaths: ['/reserve'] };
    expect(
      permittedUrl('https://search.example/reserve', scoped, 'POST', { booking: true })
        .pathname,
    ).toBe('/reserve');
    // An unlisted path is refused, and a search path is not widened by booking.
    expect(() =>
      permittedUrl('https://search.example/passengers', scoped, 'POST', {
        booking: true,
      }),
    ).toThrow();
    expect(() =>
      permittedUrl('https://search.example/passengers', scoped, 'POST'),
    ).toThrow();
    expect(
      permittedUrl('https://search.example/search', scoped, 'POST', { booking: true })
        .pathname,
    ).toBe('/search');
  });

  it('rejects a private target even if an operator accidentally allowlists its origin', async () => {
    const local = { ...site, origins: ['http://127.0.0.1'] };
    await expect(
      pinnedTransport(
        { url: 'http://127.0.0.1/', method: 'GET', headers: {} },
        local,
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow();
  });
  it('requires stated values, not instructions or defaults from a page', () => {
    expect(grounded('Lagos', 'Find Lagos to Dubai for one adult')).toBe(true);
    expect(grounded('1', 'Find Lagos to Dubai for one adult')).toBe(true);
    expect(grounded('2', 'Find Lagos to Dubai for one adult')).toBe(false);
    expect(grounded('secret', 'Find Lagos to Dubai')).toBe(false);
    expect(grounded('', 'Find Lagos to Dubai')).toBe(false);
  });
});

describe('party-size grounding', () => {
  it.each([
    ['11', 'Find Lagos to Dubai on 2026-11-02', false],
    ['2', 'Find Lagos to Dubai on November 2', false],
    ['1', 'Find flight 1 from Lagos to Dubai', false],
    ['2', 'Find Lagos to Dubai for two adults', true],
    ['11', 'Find Lagos to Dubai for 11 passengers', true],
    ['3', 'A party of three to Dubai', true],
    ['2', 'Two adults and one child to Dubai', false],
    ['1', 'One adult, or perhaps two adults', false],
  ])(
    'grounds count %s only in an explicit, unambiguous party: %s',
    (value, request, allowed) => {
      expect(groundedField('Travelers', value, request)).toBe(allowed);
    },
  );
  it('grounds the displayed count rather than an opaque select value', () => {
    expect(groundedField('Adults', 'count-zero', 'one adult', '1 adult')).toBe(true);
    expect(groundedField('Adults', '1', 'one adult', '2 adults')).toBe(false);
  });
});
