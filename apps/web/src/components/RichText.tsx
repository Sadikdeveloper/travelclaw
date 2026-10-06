import type { ReactNode } from 'react';

/**
 * The desk writes in a small, fixed subset of Markdown: paragraphs, `**bold**`,
 * `- ` and `1. ` lists, a lone `**Heading**` line, and `---` rules. It is
 * rendered here rather than by a Markdown library so the shape of a reply is
 * predictable — a tool summary full of asterisks and brackets can never turn
 * into a link, an image, or a script.
 */
export function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="prose">
      {blocks.flatMap((block, index) => renderBlock(block, index))}
    </div>
  );
}

/**
 * One block is either a list, a rule, or a run of lines where a line that is
 * nothing but bold text heads the lines under it — which is how the desk writes
 * an itinerary day by day.
 */
function renderBlock(block: string, index: number): ReactNode[] {
  const lines = block.split('\n').map((line) => line.trimEnd());
  if (lines.length === 1 && /^-{3,}$/.test(lines[0])) {
    return [<hr key={index} />];
  }
  if (lines.every((line) => /^[-*]\s+/.test(line))) {
    return [
      <ul key={index}>
        {lines.map((line, lineIndex) => (
          <li key={`${index}-${lineIndex}`}>{inline(line.replace(/^[-*]\s+/, ''))}</li>
        ))}
      </ul>,
    ];
  }
  if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
    return [
      <ol key={index}>
        {lines.map((line, lineIndex) => (
          <li key={`${index}-${lineIndex}`}>{inline(line.replace(/^\d+[.)]\s+/, ''))}</li>
        ))}
      </ol>,
    ];
  }

  const out: ReactNode[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    out.push(
      <p key={`${index}-p${out.length}`}>
        {paragraph.map((line, lineIndex) => (
          <span key={`${index}-${out.length}-${lineIndex}`}>
            {inline(line)}
            {lineIndex < paragraph.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>,
    );
    paragraph = [];
  };
  for (const line of lines) {
    const heading = /^\*\*([^*]+)\*\*$/.exec(line);
    if (heading) {
      flush();
      out.push(<h3 key={`${index}-h${out.length}`}>{heading[1]}</h3>);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out;
}

function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={index}>{part}</span>
      ),
    );
}
