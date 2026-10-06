import { describe, expect, it } from 'vitest';
import {
  assemblePrompt,
  fitMemoryLines,
  MEMORY_MAX_BYTES,
  MEMORY_MAX_LINES,
} from './prompt';

const encoder = new TextEncoder();

function bytes(lines: string[]): number {
  return lines.reduce((total, line) => total + encoder.encode(line).length + 1, 0);
}

describe('memory budget', () => {
  it('drops blank lines and keeps the order it was given', () => {
    expect(fitMemoryLines(['[fact] one', '   ', '[fact] two', ''])).toEqual([
      '[fact] one',
      '[fact] two',
    ]);
  });

  it('keeps at most the twelve lines a turn has always carried', () => {
    const lines = Array.from({ length: 30 }, (_, index) => `[fact] note ${index}`);
    const kept = fitMemoryLines(lines);
    expect(kept).toHaveLength(MEMORY_MAX_LINES);
    expect(kept[0]).toBe('[fact] note 0');
  });

  it('keeps the bytes inside the budget, skipping a line that cannot fit', () => {
    const long = `[fact] ${'x'.repeat(MEMORY_MAX_BYTES)}`;
    const kept = fitMemoryLines(['[fact] short', long, '[fact] also short']);
    // The over-long note is skipped, not truncated: a half note is worse than the
    // whole one after it.
    expect(kept).toEqual(['[fact] short', '[fact] also short']);
    expect(bytes(kept)).toBeLessThanOrEqual(MEMORY_MAX_BYTES);
  });

  it('fits as many long notes as the budget allows and no more', () => {
    const kept = fitMemoryLines(
      Array.from({ length: 12 }, (_, index) => `[fact] ${'y'.repeat(600)} ${index}`),
    );
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(MEMORY_MAX_LINES);
    expect(bytes(kept)).toBeLessThanOrEqual(MEMORY_MAX_BYTES);
  });

  it('leaves the Memory section out of the prompt when nothing fits', () => {
    const prompt = assemblePrompt(
      {
        text: 'hello',
        persona: { name: 'Marlow', soul: 'Be brief.', identity: '', user: '', agents: '' },
        memory: ['   ', ''],
        history: [],
      },
      [],
    );
    expect(prompt).not.toContain('## Memory');
  });

  it("sends an unstructured question to the desk's own research, with attribution", () => {
    const prompt = assemblePrompt(
      {
        text: 'Any good restaurants in Lisbon?',
        persona: { name: 'Marlow', soul: '', identity: '', user: '', agents: '' },
        memory: [],
        history: [],
      },
      [],
    );
    expect(prompt).toContain('no structured source');
    expect(prompt).toContain('name the page');
    expect(prompt).toContain('never pass off memory');
  });

  it('never lets the desk claim a table, room, or ticket is held', () => {
    const prompt = assemblePrompt(
      {
        text: 'hello',
        persona: { name: 'Marlow', soul: '', identity: '', user: '', agents: '' },
        memory: [],
        history: [],
      },
      [],
    );
    expect(prompt).toContain(
      'Never say a flight, room, table, or ticket is booked or available.',
    );
  });

  it('caps the memory a caller can put in a prompt', () => {
    const prompt = assemblePrompt(
      {
        text: 'hello',
        persona: { name: 'Marlow', soul: 'Be brief.', identity: '', user: '', agents: '' },
        memory: Array.from({ length: 40 }, (_, index) => `[fact] note ${index}`),
        history: [],
      },
      [],
    );
    const section = prompt.split('## Memory\n')[1].split('\n\n')[0];
    expect(section.split('\n')).toHaveLength(MEMORY_MAX_LINES);
    expect(section).toContain('note 0');
    expect(section).not.toContain('note 12');
  });

  it('enforces the byte budget at assembly, not only in the helper', () => {
    const prompt = assemblePrompt(
      {
        text: 'hello',
        persona: { name: 'Marlow', soul: 'Be brief.', identity: '', user: '', agents: '' },
        // Twelve of these would be 7 KB of prompt: the old line-only cap allowed it.
        memory: Array.from(
          { length: 40 },
          (_, index) => `[fact] ${'z'.repeat(600)} ${index}`,
        ),
        history: [],
      },
      [],
    );
    const section = prompt.split('## Memory\n')[1].split('\n\n')[0];
    expect(bytes(section.split('\n'))).toBeLessThanOrEqual(MEMORY_MAX_BYTES);
    expect(section.split('\n').length).toBeLessThan(MEMORY_MAX_LINES);
  });
});
