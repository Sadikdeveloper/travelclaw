import type { SkillDoc } from './types';

/** Small frontmatter reader for our SKILL.md files. Not a general YAML parser. */
export function parseSkillMarkdown(raw: string): SkillDoc | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.trim());
  if (!match) return null;
  const meta = match[1];
  const name = /^name:\s*(.+)$/m.exec(meta)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(meta)?.[1]?.trim();
  const triggers = [...meta.matchAll(/^\s+-\s+(.+)$/gm)].map((item) => item[1].trim());
  if (!name || !description) return null;
  return { name, description, triggers, body: match[2].trim() };
}
