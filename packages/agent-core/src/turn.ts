import { assemblePrompt } from './prompt';
import { renderFallback } from './reply';
import { defaultSkillDocs, mergeSkillDocs, routeSkills, runSkills } from './skills';
import type {
  ModelProvider,
  RememberData,
  SkillContext,
  SkillDoc,
  TurnRequest,
  TurnResult,
} from './types';

export function parseCommand(text: string): { name: 'skills' | 'remember' | 'new'; rest: string } | null {
  const match = /^\/(skills|remember|new)\b\s*([\s\S]*)$/i.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase() as 'skills' | 'remember' | 'new', rest: match[2].trim() };
}

export function formatSkillList(docs: SkillDoc[]): string {
  return docs
    .map((doc) => `- ${doc.name}: ${doc.description}`)
    .join('\n');
}

export async function completeTurn(
  input: TurnRequest,
  deps: { provider: ModelProvider; ctx: SkillContext },
): Promise<TurnResult> {
  const docs = input.skillDocs?.length ? mergeSkillDocs(input.skillDocs) : defaultSkillDocs();
  const command = parseCommand(input.text);
  if (command?.name === 'skills') {
    return {
      reply: `Skills on this desk:\n${formatSkillList(docs)}`,
      skills: [],
      skillResults: [],
      provider: 'desk',
      model: 'command',
      command: 'skills',
    };
  }
  if (command?.name === 'new') {
    return {
      reply: 'Session reset is handled by the gateway.',
      skills: [],
      skillResults: [],
      provider: 'desk',
      model: 'command',
      command: 'new',
    };
  }

  const text = command?.name === 'remember' ? `/remember ${command.rest}` : input.text;
  const names =
    command?.name === 'remember' ? ['memory.remember'] : routeSkills(text, docs).slice(0, 3);
  const skillResults = await runSkills(text, names, deps.ctx);
  const remembered = skillResults.find((result) => result.name === 'memory.remember' && result.ok);
  const fallback = renderFallback(text, skillResults, input.persona.name);
  const system = assemblePrompt(input, skillResults);
  const completion = await deps.provider.complete({
    system,
    history: input.history.slice(-8),
    user: input.text,
    fallback,
  });
  return {
    reply: completion.text.trim() || fallback,
    skills: skillResults.map((result) => ({
      name: result.name,
      ok: result.ok,
      summary: result.summary,
    })),
    skillResults,
    provider: completion.provider,
    model: completion.model,
    remembered: remembered ? (remembered.data as RememberData) : undefined,
    command: command?.name,
  };
}

export function mockProvider(model = 'travelclaw-local'): ModelProvider {
  return {
    id: 'mock',
    model,
    async complete({ fallback }) {
      return { text: fallback, provider: 'mock', model };
    },
  };
}
