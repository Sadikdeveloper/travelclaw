import { describe, expect, it } from 'vitest';
import { parseToolArgs, zodToJsonSchema } from './tool-args';
import { findTool, toolSpecs } from './tools';

describe('zodToJsonSchema', () => {
  it('derives the provider schema from the tool argument schema', () => {
    const outline = toolSpecs().find((spec) => spec.name === 'trip.outline');
    expect(outline?.description).toMatch(/day-by-day/);
    expect(outline?.parameters.required).toEqual(['destination', 'startDate']);
    expect(outline?.parameters.properties.destination).toMatchObject({
      type: 'string',
      description: expect.stringMatching(/Lisbon/),
    });
    expect(outline?.parameters.properties.startDate).toMatchObject({
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    });
    expect(outline?.parameters.properties.pace).toMatchObject({
      enum: ['relaxed', 'steady', 'packed'],
    });
    expect(outline?.parameters.properties.interests).toMatchObject({ type: 'array' });
    expect(outline?.parameters.additionalProperties).toBe(false);
  });

  it('marks an all-optional tool with no required list', () => {
    const packing = toolSpecs().find((spec) => spec.name === 'packing.list');
    expect(packing?.parameters.required).toBeUndefined();
  });

  it('gives every bundled tool a usable spec', () => {
    const specs = toolSpecs();
    expect(specs).toHaveLength(8);
    for (const spec of specs) {
      expect(spec.name).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(Object.keys(spec.parameters.properties).length).toBeGreaterThan(0);
    }
  });

  it('refuses to invent a schema for an unsupported type', () => {
    expect(() => zodToJsonSchema(zodToJsonSchema as never)).toThrow(/zod object/);
  });
});

describe('parseToolArgs', () => {
  const currency = findTool('currency.convert')!;

  it('accepts valid arguments and normalizes currency codes', () => {
    const parsed = parseToolArgs(
      currency,
      '{"amount": 100, "fromCurrency": "usd", "toCurrency": "eur"}',
    );
    expect(parsed).toEqual({
      ok: true,
      hints: { amount: 100, fromCurrency: 'USD', toCurrency: 'EUR' },
    });
  });

  it('rejects a payload that does not match, without coercing it', () => {
    const parsed = parseToolArgs(
      currency,
      '{"amount": "one hundred", "fromCurrency": "USD", "toCurrency": "EUR"}',
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/amount/);
  });

  it('rejects arguments that are not JSON, or not an object', () => {
    expect(parseToolArgs(currency, 'amount=100').ok).toBe(false);
    expect(parseToolArgs(currency, '[100, "USD", "EUR"]').ok).toBe(false);
    expect(parseToolArgs(currency, '"100 USD to EUR"').ok).toBe(false);
  });

  it('treats blank arguments as an empty object', () => {
    expect(parseToolArgs(findTool('packing.list')!, '').ok).toBe(true);
    expect(parseToolArgs(currency, '   ').ok).toBe(false);
  });

  it('drops unknown fields instead of passing them to the tool', () => {
    const parsed = parseToolArgs(
      currency,
      '{"amount": 10, "fromCurrency": "USD", "toCurrency": "EUR", "book": true}',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.hints).not.toHaveProperty('book');
  });
});
