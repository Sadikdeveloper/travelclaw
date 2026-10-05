import type { MemoryKind } from '@travelclaw/shared';

/**
 * The `MEMORY.md` bullet format. One definition, used by the importer, by
 * `remember`, and by the forget path that has to find the line again — a bullet
 * left behind in the file is re-imported on the next boot.
 */
const BULLET =
  /^- \[(preference|fact|decision)]\s+(.+?)(?:\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/;

export interface MemoryBullet {
  kind: MemoryKind;
  body: string;
  noteDate?: string;
}

export function formatMemoryBullet(
  kind: MemoryKind,
  body: string,
  noteDate: string,
): string {
  return `- [${kind}] ${body} (${noteDate})`;
}

/** Parse one line of `MEMORY.md`, or `null` when the line is not a memory bullet. */
export function parseMemoryBullet(line: string): MemoryBullet | null {
  const match = BULLET.exec(line);
  if (!match) return null;
  return {
    kind: match[1] as MemoryKind,
    body: match[2].trim(),
    noteDate: match[3],
  };
}

/** Every bullet in a file, in file order. */
export function parseMemoryBullets(content: string): MemoryBullet[] {
  const bullets: MemoryBullet[] = [];
  for (const line of content.split('\n')) {
    const bullet = parseMemoryBullet(line);
    if (bullet) bullets.push(bullet);
  }
  return bullets;
}
