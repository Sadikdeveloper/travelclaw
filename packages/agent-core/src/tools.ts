import { MAX_OUTLINE_DAYS } from '@travelclaw/shared';
import { eachDate, inclusiveDayCount } from './dates';
import { findDestinationByName } from './destinations';
import { extractHints } from './extract';
import type {
  BudgetData,
  CurrencyData,
  OutlineData,
  PackingData,
  PlacesData,
  RememberData,
  ToolContext,
  ToolResult,
  ThemeCard,
  TripHints,
  VisaData,
  WeatherData,
} from './types';

interface ToolDefinition {
  name: string;
  description: string;
  triggers: string[];
  run: (text: string, ctx: ToolContext) => Promise<ToolResult>;
}

const USD_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  JPY: 149,
  MAD: 10,
  MXN: 18.5,
  THB: 34,
  ZAR: 18,
  KRW: 1380,
  TRY: 34,
  PEN: 3.7,
  CAD: 1.36,
  ISK: 137,
};

export const BUNDLED_TOOLS: ToolDefinition[] = [
  {
    name: 'trip.outline',
    description: 'Build a day-by-day outline from a destination and dates.',
    triggers: ['itinerary', 'outline', 'plan my', 'days in'],
    run: async (text) => {
      const hints = extractHints(text);
      const data = buildOutline(hints);
      if (!data) {
        return {
          name: 'trip.outline',
          ok: false,
          summary:
            'Need a city and dates in YYYY-MM-DD, or a start date plus a day count under 19.',
          data: null,
        };
      }
      return {
        name: 'trip.outline',
        ok: true,
        summary: `${data.days.length}-day outline for ${data.destination}. Availability was not checked.`,
        data,
      };
    },
  },
  {
    name: 'budget.estimate',
    description: 'Estimate on-the-ground daily spend. Flights are excluded.',
    triggers: ['budget', 'cost', 'how much'],
    run: async (text) => {
      const hints = extractHints(text);
      const data = estimateBudget(hints);
      if (!data) {
        return {
          name: 'budget.estimate',
          ok: false,
          summary:
            'Need a city and a length (two dates or a day count) before I estimate a budget.',
          data: null,
        };
      }
      return {
        name: 'budget.estimate',
        ok: true,
        summary: `About $${data.total} USD on the ground for ${data.travelers} over ${data.days} days. Flights excluded.`,
        data,
      };
    },
  },
  {
    name: 'packing.list',
    description: 'Pack a bag from climate and trip length.',
    triggers: ['pack', 'packing', 'suitcase'],
    run: async (text) => {
      const hints = extractHints(text);
      const data = buildPackingList(hints);
      return {
        name: 'packing.list',
        ok: true,
        summary: `${data.items.length} packing notes for ${data.destination}, ${data.climate}.`,
        data,
      };
    },
  },
  {
    name: 'places.suggest',
    description: 'Suggest a few anchors in one city.',
    triggers: ['where to eat', 'neighborhood', 'places in'],
    run: async (text) => {
      const hints = extractHints(text);
      if (!hints.destination) {
        return {
          name: 'places.suggest',
          ok: false,
          summary: 'Name a city and I will keep the list short.',
          data: null,
        };
      }
      const data = suggestPlaces(hints);
      return {
        name: 'places.suggest',
        ok: true,
        summary: data.known
          ? `${data.places.length} anchors in ${data.destination}.`
          : `No desk card for ${data.destination}. Generic anchors only.`,
        data,
      };
    },
  },
  {
    name: 'currency.convert',
    description: 'Convert an amount between currencies.',
    triggers: ['convert', 'exchange', 'currency'],
    run: async (text, ctx) => {
      const hints = extractHints(text);
      if (!hints.amount || !hints.fromCurrency || !hints.toCurrency) {
        return {
          name: 'currency.convert',
          ok: false,
          summary: 'Use an amount and two codes, for example "convert 100 USD to EUR".',
          data: null,
        };
      }
      const data = await convertCurrency(
        hints.amount,
        hints.fromCurrency,
        hints.toCurrency,
        ctx,
      );
      return {
        name: 'currency.convert',
        ok: true,
        summary: `${data.amount} ${data.from} is about ${data.converted} ${data.to} (${data.source}).`,
        data,
      };
    },
  },
  {
    name: 'weather.outlook',
    description: 'Summarize a short forecast or a seasonal note.',
    triggers: ['weather', 'forecast', 'rain'],
    run: async (text, ctx) => {
      const hints = extractHints(text);
      if (!hints.destination) {
        return {
          name: 'weather.outlook',
          ok: false,
          summary: 'Name a city before I check the sky.',
          data: null,
        };
      }
      const data = await weatherOutlook(hints, ctx);
      return {
        name: 'weather.outlook',
        ok: true,
        summary: data.summary,
        data,
      };
    },
  },
  {
    name: 'visa.notes',
    description: 'Entry checklist. Not a visa ruling.',
    triggers: ['visa', 'entry', 'passport'],
    run: async (text) => {
      const hints = extractHints(text);
      const data = visaNotes(hints);
      return {
        name: 'visa.notes',
        ok: true,
        summary: 'Checklist only. This desk does not rule on entry.',
        data,
      };
    },
  },
  {
    name: 'memory.remember',
    description: 'Store a preference, fact, or decision.',
    triggers: ['remember', 'i prefer', 'i always'],
    run: async (text) => {
      const hints = extractHints(text);
      if (!hints.rememberText) {
        return {
          name: 'memory.remember',
          ok: false,
          summary:
            'Say what to remember, for example "/remember I prefer trains to taxis".',
          data: null,
        };
      }
      const data = rememberFromText(hints.rememberText);
      return {
        name: 'memory.remember',
        ok: true,
        summary: `Noted as a ${data.kind}.`,
        data,
      };
    },
  },
];

export function routeTools(
  text: string,
  tools: Array<{ name: string; triggers: string[] }> = BUNDLED_TOOLS,
): string[] {
  const lower = text.toLowerCase();
  const hinted = extractHints(text);
  const scored = tools
    .map((tool) => {
      const triggerHit = tool.triggers.some((trigger) =>
        lower.includes(trigger.toLowerCase()),
      );
      const structured = structuredHit(tool.name, hinted, lower);
      return { name: tool.name, score: (triggerHit ? 2 : 0) + (structured ? 3 : 0) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const names: string[] = [];
  for (const item of scored) {
    if (!names.includes(item.name)) names.push(item.name);
    if (names.length === 3) break;
  }
  return names;
}

function structuredHit(name: string, hints: TripHints, lower: string): boolean {
  if (
    name === 'trip.outline' &&
    hints.destination &&
    (hints.startDate || /\bplan\b|\boutline\b|\btrip\b/.test(lower))
  ) {
    return Boolean(hints.startDate || hints.days);
  }
  if (name === 'budget.estimate' && hints.destination && (hints.days || hints.startDate)) {
    return /\b(budget|cost|spend|how much)\b/.test(lower);
  }
  if (name === 'currency.convert')
    return Boolean(hints.amount && hints.fromCurrency && hints.toCurrency);
  if (name === 'memory.remember') return Boolean(hints.rememberText);
  return false;
}

export async function runTools(
  text: string,
  names: string[],
  ctx: ToolContext,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const name of names) {
    const tool = BUNDLED_TOOLS.find((item) => item.name === name);
    if (!tool) continue;
    results.push(await tool.run(text, ctx));
  }
  return results;
}

export function buildOutline(hints: TripHints): OutlineData | null {
  if (!hints.destination || !hints.startDate || !hints.endDate) return null;
  const count = inclusiveDayCount(hints.startDate, hints.endDate);
  if (count <= 0) return null;
  if (count > MAX_OUTLINE_DAYS) {
    return null;
  }
  const profile = findDestinationByName(hints.destination);
  const pace = hints.pace ?? 'steady';
  const themes = orderThemes(
    profile?.themes ?? genericThemes(hints.destination),
    hints.interests,
  );
  const dates = eachDate(hints.startDate, hints.endDate);
  const days = dates.map((date, index) => {
    const theme = themes[index % themes.length];
    const arrival = index === 0 && dates.length > 1;
    const departure = index === dates.length - 1 && dates.length > 1;
    if (arrival) {
      return {
        date,
        title: `Arrival in ${profile?.neighborhoods[0]?.name ?? 'the center'}`,
        summary:
          'Check in, learn the walk to food, and stop early. Do not spend the arrival day on a far-side attraction.',
        places: profile?.neighborhoods.slice(0, 2).map((item) => item.name) ?? [
          'Central streets',
          'A nearby grocer',
        ],
      };
    }
    if (departure) {
      return {
        date,
        title: 'Leave with a buffer',
        summary:
          'One morning anchor near your bag. Airport transfers are not in this outline.',
        places: [theme.places[0] ?? 'A cafe near the door'],
      };
    }
    return {
      date,
      title: theme.title,
      summary: theme.summary,
      places: theme.places.slice(0, pace === 'relaxed' ? 2 : pace === 'packed' ? 4 : 3),
    };
  });
  return {
    destination: profile?.name ?? hints.destination,
    known: Boolean(profile),
    pace,
    days,
    assumptions: [
      'Availability was not checked. Nothing is held.',
      'Flights and airport transfers are excluded.',
      profile
        ? `Transit note: ${profile.transit}`
        : 'This city has no desk card, so the days are a pacing template.',
      dates.length === MAX_OUTLINE_DAYS && count > MAX_OUTLINE_DAYS
        ? `Range was longer than ${MAX_OUTLINE_DAYS} days and was not outlined.`
        : `Pace is ${pace}.`,
    ],
  };
}

export function estimateBudget(hints: TripHints): BudgetData | null {
  if (!hints.destination) return null;
  const days =
    hints.startDate && hints.endDate
      ? inclusiveDayCount(hints.startDate, hints.endDate)
      : (hints.days ?? 0);
  if (days <= 0 || days > 60) return null;
  const profile = findDestinationByName(hints.destination);
  const style = hints.style ?? 'comfortable';
  const daily =
    profile?.dailyUsd[style] ?? (style === 'lean' ? 90 : style === 'splurge' ? 280 : 150);
  const travelers = hints.travelers ?? 1;
  const stay = Math.round(daily * 0.46);
  const food = Math.round(daily * 0.27);
  const localTransit = Math.round(daily * 0.1);
  const activities = Math.round(daily * 0.09);
  const buffer = daily - stay - food - localTransit - activities;
  return {
    destination: profile?.name ?? hints.destination,
    days,
    travelers,
    style,
    currency: 'USD',
    daily,
    total: daily * days * travelers,
    breakdown: { stay, food, localTransit, activities, buffer },
    excluded: ['flights', 'airport transfers', 'travel insurance', 'visas'],
  };
}

export function buildPackingList(hints: TripHints): PackingData {
  const profile = hints.destination ? findDestinationByName(hints.destination) : undefined;
  const climate = profile?.climate ?? 'temperate';
  const days =
    hints.days ??
    (hints.startDate && hints.endDate
      ? inclusiveDayCount(hints.startDate, hints.endDate)
      : 5);
  const safeDays = Math.min(Math.max(days || 5, 1), 21);
  const items: PackingData['items'] = [
    {
      name: 'Passport and a paper copy',
      qty: '1',
      category: 'documents',
      why: 'The copy stays separate from the passport.',
    },
    {
      name: 'Any medicine you already take',
      qty: 'enough for the trip plus two days',
      category: 'health',
      why: 'Do not start a new drug because a list suggested it.',
    },
    {
      name: 'Phone charger and a plug adapter',
      qty: '1',
      category: 'kit',
      why: 'Check the plug type before you buy a second adapter.',
    },
    {
      name: 'Shirts or tops',
      qty: String(Math.min(Math.ceil(safeDays / 2), 6)),
      category: 'clothes',
      why: 'Laundry exists. A full day-per-shirt bag does not help.',
    },
    {
      name: 'Underwear and socks',
      qty: String(Math.min(safeDays, 8)),
      category: 'clothes',
      why: 'The item people underpack.',
    },
  ];
  if (climate === 'hot-humid' || climate === 'hot-dry') {
    items.push(
      {
        name: 'Breathable clothes',
        qty: 'the tops above',
        category: 'climate',
        why: 'Heat is the constraint, not outfits.',
      },
      {
        name: 'Sun layer and a hat',
        qty: '1',
        category: 'climate',
        why: profile?.packingNotes[0] ?? 'Midday is long.',
      },
    );
  }
  if (climate === 'cold' || climate === 'alpine') {
    items.push(
      {
        name: 'Warm midlayer',
        qty: '1',
        category: 'climate',
        why: 'Evenings drop even when the noon photo looks mild.',
      },
      {
        name: 'Windproof shell',
        qty: '1',
        category: 'climate',
        why: profile?.packingNotes[0] ?? 'Wind matters more than a fashion coat.',
      },
    );
  }
  if (climate === 'temperate' || climate === 'variable') {
    items.push({
      name: 'Light rain shell',
      qty: '1',
      category: 'climate',
      why: 'A shell beats an umbrella on cobbles and ferries.',
    });
  }
  if (climate === 'alpine') {
    items.push({
      name: 'Sun protection at altitude',
      qty: '1',
      category: 'climate',
      why: 'The air is thin and the sun is not milder.',
    });
  }
  for (const note of profile?.packingNotes ?? []) {
    items.push({
      name: note,
      qty: '1',
      category: 'desk note',
      why: `From the ${profile?.name} card.`,
    });
  }
  return {
    destination: profile?.name ?? hints.destination ?? 'a city you have not named',
    climate,
    days: safeDays,
    items,
  };
}

export function suggestPlaces(hints: TripHints): PlacesData {
  const profile = hints.destination ? findDestinationByName(hints.destination) : undefined;
  if (!profile || !hints.destination) {
    return {
      destination: hints.destination ?? 'unknown',
      known: false,
      places: genericThemes(hints.destination ?? 'the city')
        .slice(0, 3)
        .map((theme) => ({
          name: theme.places[0] ?? theme.title,
          area: 'center',
          kind: 'template',
          note: theme.summary,
        })),
    };
  }
  const themes = orderThemes(profile.themes, hints.interests);
  const places = themes.slice(0, 3).map((theme, index) => ({
    name: theme.places[0] ?? theme.title,
    area: profile.neighborhoods[index % profile.neighborhoods.length]?.name ?? 'center',
    kind: hints.interests[0] ?? 'anchor',
    note: theme.summary,
  }));
  if (hints.interests.includes('food')) {
    places.unshift({
      name: profile.food[0] ?? 'a local lunch',
      area: profile.neighborhoods[0]?.name ?? 'center',
      kind: 'food',
      note: 'Eat this once, seated, not as a photo stop.',
    });
  }
  return { destination: profile.name, known: true, places: places.slice(0, 4) };
}

export async function convertCurrency(
  amount: number,
  from: string,
  to: string,
  ctx: ToolContext,
): Promise<CurrencyData> {
  if (ctx.network && ctx.fetchImpl) {
    try {
      const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${amount}`;
      const response = await fetchWithTimeout(ctx.fetchImpl, url, 4000);
      if (response.ok) {
        const body = (await response.json()) as { rates?: Record<string, number> };
        const converted = body.rates?.[to];
        if (typeof converted === 'number') {
          return {
            amount,
            from,
            to,
            rate: roundRate(converted / amount),
            converted: roundMoney(converted),
            source: 'frankfurter',
            approximate: false,
          };
        }
      }
    } catch {
      // Desk table below is the labeled fallback.
    }
  }
  const fromRate = USD_RATES[from];
  const toRate = USD_RATES[to];
  if (!fromRate || !toRate) {
    return {
      amount,
      from,
      to,
      rate: 0,
      converted: 0,
      source: 'desk-table',
      approximate: true,
    };
  }
  const converted = (amount / fromRate) * toRate;
  return {
    amount,
    from,
    to,
    rate: roundRate(toRate / fromRate),
    converted: roundMoney(converted),
    source: 'desk-table',
    approximate: true,
  };
}

export async function weatherOutlook(
  hints: TripHints,
  ctx: ToolContext,
): Promise<WeatherData> {
  const profile = hints.destination ? findDestinationByName(hints.destination) : undefined;
  const destination = profile?.name ?? hints.destination ?? 'that city';
  if (ctx.network && ctx.fetchImpl && profile) {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(profile.coordinates.lat));
      url.searchParams.set('longitude', String(profile.coordinates.lon));
      url.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min');
      url.searchParams.set('timezone', 'auto');
      url.searchParams.set('forecast_days', '5');
      const response = await fetchWithTimeout(ctx.fetchImpl, url.toString(), 4000);
      if (response.ok) {
        const body = (await response.json()) as {
          daily?: {
            time?: string[];
            weathercode?: number[];
            temperature_2m_max?: number[];
            temperature_2m_min?: number[];
          };
        };
        const time = body.daily?.time ?? [];
        const days = time.slice(0, 5).map((date, index) => ({
          date,
          label: weatherLabel(body.daily?.weathercode?.[index]),
          highC: body.daily?.temperature_2m_max?.[index] ?? null,
          lowC: body.daily?.temperature_2m_min?.[index] ?? null,
        }));
        if (days.length) {
          const first = days[0];
          return {
            destination,
            source: 'open-meteo',
            summary: `${destination}: ${first.label}, high ${first.highC ?? 'n/a'}°C. Next ${days.length} days from Open-Meteo, not a guarantee.`,
            days,
          };
        }
      }
    } catch {
      // Seasonal card below.
    }
  }
  const month = hints.startDate
    ? Number(hints.startDate.slice(5, 7))
    : ctx.now.getUTCMonth() + 1;
  return {
    destination,
    source: 'seasonal-card',
    summary: profile
      ? `${destination} is generally ${profile.climate.replace('-', ' ')}. Desk months: ${profile.bestMonths}. This is a seasonal note for month ${month}, not a forecast.`
      : `No climate card for ${destination}. Pack a midlayer and check a forecast the week you fly.`,
    days: [],
  };
}

export function visaNotes(hints: TripHints): VisaData {
  const destination = hints.destination ?? 'the destination';
  return {
    destination,
    passportCountry: hints.passportCountry ?? null,
    disclaimer:
      'This is a checklist, not an entry ruling. The desk does not store a visa matrix because those rules change.',
    checks: [
      `Read the foreign ministry page for ${destination} and your own government's travel advice before you pay for a fare.`,
      hints.passportCountry
        ? `You mentioned a ${hints.passportCountry} passport. Confirm that nationality on an official page. Do not take this chat as permission to travel.`
        : 'Have the passport country ready. Rules are nationality-specific.',
      'Check passport validity, blank pages, and whether a return or onward ticket is asked for.',
      'Check proof of funds, accommodation, and insurance only if an official page asks for them.',
      'If a visa is required, apply with the lead time on the official site, not a blog summary.',
    ],
  };
}

export function rememberFromText(text: string): RememberData {
  const lower = text.toLowerCase();
  const kind = /\b(decide|decided|we will|we'll|book the)\b/.test(lower)
    ? 'decision'
    : /\b(prefer|always|never|don't like|do not like|hate|love)\b/.test(lower)
      ? 'preference'
      : 'fact';
  const body = text.replace(/\s+/g, ' ').trim();
  const title = body.length > 52 ? `${body.slice(0, 52)}…` : body;
  return { kind, title, body };
}

function orderThemes(themes: ThemeCard[], interests: string[]): ThemeCard[] {
  if (!interests.length) return themes;
  return [...themes].sort((a, b) => scoreTheme(b, interests) - scoreTheme(a, interests));
}

function scoreTheme(theme: ThemeCard, interests: string[]): number {
  const blob = `${theme.title} ${theme.summary} ${theme.places.join(' ')}`.toLowerCase();
  return interests.reduce(
    (total, interest) => total + (blob.includes(interest) ? 1 : 0),
    0,
  );
}

function genericThemes(city: string): ThemeCard[] {
  return [
    {
      title: `Arrival in ${city}`,
      summary: 'Learn the walk from the door to food. Stop early.',
      places: ['Central square', 'A grocer', 'The street you will use at night'],
    },
    {
      title: 'One neighborhood',
      summary: 'Stay inside a 20-minute walk. Eat where lunch is local.',
      places: ['A market', 'A small museum', 'A park bench'],
    },
    {
      title: 'A far anchor, then back',
      summary: 'One trip across town, then return. Do not add a second crossing.',
      places: ['One far anchor', 'The way back', 'Dinner near the door'],
    },
  ];
}

function weatherLabel(code: number | undefined): string {
  if (code === undefined) return 'unspecified sky';
  if (code === 0) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code <= 48) return 'fog';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'showers';
  return 'storms';
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRate(value: number): number {
  return Math.round(value * 10000) / 10000;
}
