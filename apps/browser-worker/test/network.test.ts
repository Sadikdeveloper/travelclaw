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
