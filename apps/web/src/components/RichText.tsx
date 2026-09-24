export function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="prose">
      {blocks.map((block, index) => {
        const lines = block.split('\n');
        if (lines.every((line) => line.startsWith('- '))) {
          return (
            <ul key={index}>
              {lines.map((line) => (
                <li key={line}>{inline(line.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={`${index}-${lineIndex}`}>
                {inline(line)}
                {lineIndex < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
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
