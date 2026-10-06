import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichText } from './RichText';

/** A rendered reply, the way the desk actually writes one. */
const markup = (text: string) => renderToStaticMarkup(<RichText text={text} />);

describe('rendering a desk reply', () => {
  it('turns a bold line into a heading for the days under it', () => {
    const html = markup(
      '**2026-11-01 — Arrival in Alfama**\nCheck in and stop early.\nAnchors: Alfama.\n\n**2026-11-02 — Chiado**\nBookshops, then the river.',
    );
    expect(html.match(/<h3>/g)).toHaveLength(2);
    expect(html).toContain('<h3>2026-11-01 — Arrival in Alfama</h3>');
    expect(html).toContain('Check in and stop early.');
    expect(html).toContain('<h3>2026-11-02 — Chiado</h3>');
  });

  it('keeps bold inside a sentence as emphasis, not a heading', () => {
    const html = markup('Expect **about $150 a day**, flights excluded.');
    expect(html).not.toContain('<h3>');
    expect(html).toContain('<strong>about $150 a day</strong>');
  });

  it('renders both list kinds and a rule', () => {
    const html = markup('- one\n- two\n\n1. first\n2. second\n\n---\n\nAfter the rule.');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain('<hr/>');
  });

  it('never renders markup hidden in the text', () => {
    const html = markup('Use <script>alert(1)</script> and [a link](https://example.org).');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
