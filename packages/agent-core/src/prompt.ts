import type { ToolResult, TurnRequest } from './types';

const EMPTY = /^\s*$/;

export function assemblePrompt(
  input: TurnRequest,
  tools: ToolResult[],
  options: { toolCalling?: boolean } = {},
): string {
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
  const toolBlock = options.toolCalling
    ? 'No tool has run yet. Call the tools that fit this request, then wait for their results. Never invent a price, a weather number, an availability, or an entry ruling.'
    : tools.length
      ? tools
          .map(
            (tool) =>
              `### ${tool.name} (${tool.ok ? 'ok' : 'needs input'})\n${tool.summary}\n${JSON.stringify(tool.data)}`,
          )
          .join('\n\n')
      : 'No tool ran.';

  return [
    `You are ${input.persona.name}, answering inside TravelClaw.`,
    'Lead with tool results when they exist. Do not contradict them. Do not add prices, weather numbers, or entry rulings that are not in those results.',
    'Never say a flight, room, or ticket is booked or available.',
    ...files,
    section('Memory', memory.join('\n')),
    trip,
    options.toolCalling ? 'Tools for this turn:' : 'Tool results for this turn:',
    toolBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function section(title: string, body: string): string {
  if (!body || EMPTY.test(body)) return '';
  return `## ${title}\n${body.trim()}`;
}
