import { describe, expect, it } from 'vitest';
import { hasSearchMarket, mergeSearchMarket, searchMarketFrom } from './market';

describe('searchMarketFrom', () => {
  it('reads a booker country only from a phrase that names the booker', () => {
    expect(
      searchMarketFrom('Find a flight from Lagos to Lisbon, I am based in Nigeria'),
    ).toEqual({ bookerCountry: 'NG' });
    expect(searchMarketFrom('Booking from the UK, flight LOS to LIS')).toEqual({
      bookerCountry: 'GB',
    });
    expect(searchMarketFrom('booker country: ng')).toEqual({ bookerCountry: 'NG' });
    expect(searchMarketFrom('point of sale US, hotel in Lisbon')).toEqual({
      bookerCountry: 'US',
    });
  });

  it('never turns a route or a destination into a point of sale', () => {
    expect(searchMarketFrom('Find a flight from Lagos to Lisbon on 2026-11-02')).toEqual(
      {},
    );
    expect(searchMarketFrom('Book a hotel in Nigeria for 2 nights')).toEqual({});
    expect(searchMarketFrom('I land in MAD at 14:00')).toEqual({});
    expect(searchMarketFrom('A guesthouse in the Netherlands')).toEqual({});
  });

  it('reads a currency only from pricing language, never from a place or a budget', () => {
    expect(searchMarketFrom('Find a flight Lagos to Lisbon, price it in NGN')).toEqual({
      currency: 'NGN',
    });
    expect(searchMarketFrom('Show hotel fares in EUR for Lisbon')).toEqual({
      currency: 'EUR',
    });
    expect(searchMarketFrom('Flights from Lagos to London in GBP please')).toEqual({
      currency: 'GBP',
    });
    expect(searchMarketFrom('currency: ngn')).toEqual({ currency: 'NGN' });
    expect(searchMarketFrom('quote in naira')).toEqual({ currency: 'NGN' });
  });

  it('refuses codes that are also ordinary words or airport names', () => {
    expect(searchMarketFrom('Find me a hotel in Rio')).toEqual({});
    expect(searchMarketFrom('What is the best country in the world')).toEqual({});
    expect(searchMarketFrom('Book a stay in Doha for two')).toEqual({});
    expect(searchMarketFrom('Our budget is 2000 EUR for the week')).toEqual({});
  });

  it('reads a content language only from an explicit language phrase', () => {
    expect(searchMarketFrom('Hotel in Lisbon, content language en-NG')).toEqual({
      language: 'en-NG',
    });
    expect(searchMarketFrom('Stay in Porto, language French')).toEqual({ language: 'fr' });
    expect(searchMarketFrom('Show prices in Spanish for Madrid')).toEqual({
      language: 'es',
    });
    expect(searchMarketFrom('Reply in French please')).toEqual({});
  });

  it('collects a full market stated in one message and nothing else', () => {
    const text =
      'I am based in Nigeria and booking from NG. Flight Lagos to Lisbon on 2026-11-02, price it in NGN, content language en-NG';
    expect(searchMarketFrom(text)).toEqual({
      bookerCountry: 'NG',
      currency: 'NGN',
      language: 'en-NG',
    });
    expect(searchMarketFrom('Two weeks in Japan, three cities, no fixed dates')).toEqual(
      {},
    );
  });
});

describe('mergeSearchMarket', () => {
  it('lets the message win and fills only the keys it left out from the operator default', () => {
    expect(
      mergeSearchMarket(
        { currency: 'NGN' },
        { bookerCountry: 'US', currency: 'USD', language: 'en-US' },
      ),
    ).toEqual({ bookerCountry: 'US', currency: 'NGN', language: 'en-US' });

    expect(
      mergeSearchMarket({}, { bookerCountry: 'US', currency: 'USD', language: 'en-US' }),
    ).toEqual({ bookerCountry: 'US', currency: 'USD', language: 'en-US' });

    expect(mergeSearchMarket({}, {})).toEqual({});
  });

  it('reports whether anything was set at all', () => {
    expect(hasSearchMarket({})).toBe(false);
    expect(hasSearchMarket({ currency: 'NGN' })).toBe(true);
  });
});
