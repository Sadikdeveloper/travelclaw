import type {
  BudgetData,
  CurrencyData,
  OutlineData,
  PackingData,
  PlacesData,
  SkillRunResult,
  VisaData,
  WeatherData,
} from './types';

export function renderFallback(text: string, results: SkillRunResult[], agentName: string): string {
  const rendered = results.filter((result) => result.ok).map(renderResult).filter(Boolean);
  const failed = results.filter((result) => !result.ok);
  if (rendered.length || failed.length) {
    const parts = [
      rendered.join('\n\n'),
      failed.length ? failed.map((result) => result.summary).join(' ') : '',
      'I have not booked anything.',
    ].filter(Boolean);
    return parts.join('\n\n');
  }
  return renderUngrounded(text, agentName);
}

export function renderResult(result: SkillRunResult): string {
  switch (result.name) {
    case 'trip.outline':
      return renderOutline(result.data as OutlineData);
    case 'budget.estimate':
      return renderBudget(result.data as BudgetData);
    case 'packing.list':
      return renderPacking(result.data as PackingData);
    case 'places.suggest':
      return renderPlaces(result.data as PlacesData);
    case 'currency.convert':
      return renderCurrency(result.data as CurrencyData);
    case 'weather.outlook':
      return (result.data as WeatherData).summary;
    case 'visa.notes':
      return renderVisa(result.data as VisaData);
    case 'memory.remember':
      return `I will keep that: ${result.summary}`;
    default:
      return result.summary;
  }
}

function renderOutline(data: OutlineData): string {
  const days = data.days
    .map((day) => `**${day.date} — ${day.title}**\n${day.summary}\nAnchors: ${day.places.join(', ')}.`)
    .join('\n\n');
  return [
    `Outline for ${data.destination}, ${data.days.length} days, ${data.pace} pace.`,
    data.known ? '' : 'This city is not on the desk card, so the days are a pacing template.',
    days,
    data.assumptions.map((item) => `- ${item}`).join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function renderBudget(data: BudgetData): string {
  const lines = [
    `Desk estimate for ${data.destination}: $${data.daily} USD per person per day, ${data.style} style.`,
    `${data.travelers} traveler${data.travelers === 1 ? '' : 's'} over ${data.days} days is about $${data.total} USD on the ground.`,
    `Per person per day: stay $${data.breakdown.stay}, food $${data.breakdown.food}, local transit $${data.breakdown.localTransit}, activities $${data.breakdown.activities}, buffer $${data.breakdown.buffer}.`,
    `Excluded: ${data.excluded.join(', ')}.`,
    'These are round desk ceilings, not quotes.',
  ];
  return lines.join('\n');
}

function renderPacking(data: PackingData): string {
  const items = data.items
    .map((item) => `- ${item.name} (${item.qty}) — ${item.why}`)
    .join('\n');
  return `Packing for ${data.destination}, ${data.days} days, ${data.climate} climate.\n\n${items}`;
}

function renderPlaces(data: PlacesData): string {
  const lines = data.places.map((place) => `- ${place.name} (${place.area}, ${place.kind}) — ${place.note}`);
  return [`Anchors in ${data.destination}.`, ...lines].join('\n');
}

function renderCurrency(data: CurrencyData): string {
  if (!data.rate) {
    return `I cannot convert ${data.from} to ${data.to} from the desk table.`;
  }
  const label = data.approximate ? 'approximate desk table' : 'Frankfurter';
  return `${data.amount} ${data.from} is about ${data.converted} ${data.to}. Rate ${data.rate} via ${label}.`;
}

function renderVisa(data: VisaData): string {
  return [data.disclaimer, ...data.checks.map((item) => `- ${item}`)].join('\n');
}

function renderUngrounded(text: string, agentName: string): string {
  if (/^(hi|hello|hey|good morning|good evening)\b/i.test(text.trim())) {
    return `I'm ${agentName}. Give me a city and two dates, or tell me what to remember. I can outline days, estimate a ground budget, pack a bag, or run an entry checklist. I do not book.`;
  }
  if (/\b(book|flight|hotel|reservation|hold a room)\b/i.test(text)) {
    return `I don't book flights or rooms, and I won't pretend a fare is available. I can shape the days, a budget ceiling, and a packing list so the booking is a smaller decision. Where are you going, and on which dates?`;
  }
  return `I don't have a skill result for that. I can outline a city, estimate on-the-ground spend, pack a bag, check a short forecast, convert a currency, or store a preference. The useful version starts with a city and dates in YYYY-MM-DD.`;
}
