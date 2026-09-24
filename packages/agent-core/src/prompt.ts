import type { SkillRunResult, TurnRequest } from './types';

const EMPTY = /^\s*$/;

export function assemblePrompt(input: TurnRequest, skills: SkillRunResult[]): string {
  const files = [
    section('Soul', input.persona.soul),
    section('Identity', input.persona.identity),
    section('Traveler', input.persona.user),
    section('Desk rules', input.persona.agents),
  ].filter(Boolean);
  const memory = input.memory.filter((line) => line.trim()).slice(0, 12);
  const trip = input.activeTrip
    ? `Active trip: ${input.activeTrip.title} in ${input.activeTrip.destination}, ${input.activeTrip.startDate} to ${input.activeTrip.endDate}, status ${input.activeTrip.status}.`
    : 'No active trip is open.';
  const skillBlock = skills.length
    ? skills
        .map((skill) => `### ${skill.name} (${skill.ok ? 'ok' : 'needs input'})\n${skill.summary}\n${JSON.stringify(skill.data)}`)
        .join('\n\n')
    : 'No skill ran.';

  return [
    `You are ${input.persona.name}, answering inside TravelClaw.`,
    'Lead with skill results when they exist. Do not contradict them. Do not add prices, weather numbers, or entry rulings that are not in those results.',
    'Never say a flight, room, or ticket is booked or available.',
    ...files,
    section('Memory', memory.join('\n')),
    trip,
    'Skill results for this turn:',
    skillBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function section(title: string, body: string): string {
  if (!body || EMPTY.test(body)) return '';
  return `## ${title}\n${body.trim()}`;
}
