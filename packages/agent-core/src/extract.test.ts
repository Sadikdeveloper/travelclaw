import { describe, expect, it } from 'vitest';
import { extractHints } from './extract';

const NOW = new Date('2026-10-06T09:00:00Z');
const hints = (text: string) => extractHints(text, NOW);

describe('reading a trip out of a sentence', () => {
  it('reads a length written as a word', () => {
    expect(hints('Plan me four days in Lisbon.')).toMatchObject({
      destination: 'Lisbon',
      days: 4,
    });
    expect(hints('five nights in Rome')).toMatchObject({ days: 5 });
    expect(hints('a week in Marrakech')).toMatchObject({ days: 7 });
    expect(hints('two weeks in Japan')).toMatchObject({ days: 14 });
    expect(hints('a fortnight in Sicily')).toMatchObject({ days: 14 });
    expect(hints('a long weekend in Porto')).toMatchObject({ days: 3 });
    expect(hints('a weekend in Porto')).toMatchObject({ days: 2 });
  });

  it('turns a named month and a length into real dates', () => {
    expect(hints('four days in Lisbon in November')).toMatchObject({
      startDate: '2026-11-01',
      endDate: '2026-11-04',
      days: 4,
    });
  });

  it('rolls a month that has already passed into next year', () => {
    expect(hints('two weeks in Japan in March')).toMatchObject({
      startDate: '2027-03-01',
      endDate: '2027-03-14',
    });
    // The current month still counts as ahead of us on the 1st.
    expect(hints('a week in October')).toMatchObject({ startDate: '2026-10-01' });
  });

  it('keeps a bare month open rather than inventing a trip length', () => {
    const open = hints('What is Lisbon like in November?');
    expect(open.destination).toBe('Lisbon');
    expect(open.days).toBeUndefined();
    expect(open.startDate).toBeUndefined();
    expect(open.endDate).toBeUndefined();
  });

  it('prefers written dates over the month anchor', () => {
    expect(hints('four days in Lisbon from 2026-12-20 in November')).toMatchObject({
      startDate: '2026-12-20',
      endDate: '2026-12-23',
    });
  });

  it('reads mid-range spending as comfortable, and keeps cheap as lean', () => {
    expect(hints('mid budget').style).toBe('comfortable');
    expect(hints('a moderate hotel').style).toBe('comfortable');
    expect(hints('something cheap').style).toBe('lean');
    expect(hints('a cheap but comfortable hotel').style).toBe('comfortable');
  });

  it('does not read a day length out of an unrelated number', () => {
    expect(hints('Table for 4 at 19:00').days).toBeUndefined();
    expect(hints('2 travelers').days).toBeUndefined();
  });
});
