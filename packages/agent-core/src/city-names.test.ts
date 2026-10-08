import { describe, expect, it } from 'vitest';
import { normalizeCityName } from './city-names';

describe('normalizing city names', () => {
  it('matches case-insensitive city names and common aliases', () => {
    expect(normalizeCityName('lagos')).toBe('Lagos');
    expect(normalizeCityName('MOSKVA')).toBe('Moscow');
    expect(normalizeCityName('lisboa')).toBe('Lisbon');
    expect(normalizeCityName('LOS')).toBe('LOS');
  });

  it('corrects a confident one-character typo without a confirmation turn', () => {
    expect(normalizeCityName('moscoww')).toBe('Moscow');
    expect(normalizeCityName('lagso')).toBe('Lagos');
    expect(normalizeCityName('moscaw')).toBe('Moscow');
  });

  it('preserves unfamiliar or ambiguous places rather than guessing', () => {
    expect(normalizeCityName('lowercase nowhere')).toBe('Lowercase Nowhere');
    expect(normalizeCityName('pari')).toBe('Pari');
  });
});
