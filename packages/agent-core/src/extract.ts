import { MAX_OUTLINE_DAYS, type BudgetStyle } from '@travelclaw/shared';
import { addDays } from './dates';
import { findDestination } from './destinations';
import type { TripHints } from './types';

const INTERESTS = [
  'food',
  'museums',
  'nightlife',
  'hiking',
  'beach',
  'design',
  'markets',
  'kids',
  'art',
  'coffee',
  'temples',
  'walking',
];

/** Dates beyond this are an outline request, not an itinerary. */
const MAX_INFERRED_DAYS = MAX_OUTLINE_DAYS;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Travelers write "four days" and "a week" far more often than "4 days". */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const COUNT_WORD = `(\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`;

const CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'MAD',
  'MXN',
  'THB',
  'ZAR',
  'KRW',
  'TRY',
  'PEN',
  'CAD',
  'ISK',
];

export function extractHints(text: string, now: Date = new Date()): TripHints {
  const dates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  const days = lengthInDays(text);
  const travelers = text.match(
    /\b(\d{1,2})\s*(travelers|travellers|people|adults|guests)\b/i,
  );
  const forParty = text.match(/\bfor\s+(\d{1,2})\b/i);
  const origin = text.match(/\bfrom\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/);
  const passport = text.match(/\bpassport\s+(?:from|of|:)\s+([A-Za-z][A-Za-z ]{1,40})/i);
  const amount = text.match(
    new RegExp(`\\b(\\d+(?:\\.\\d{1,2})?)\\s*(${CURRENCIES.join('|')})\\b`, 'i'),
  );
  const toCurrency = text.match(
    new RegExp(`\\b(?:to|in|into)\\s+(${CURRENCIES.join('|')})\\b`, 'i'),
  );
  const destination = findDestination(text);

  // A month name is a soft anchor, not a booking: "four days in November"
  // starts on the 1st so the length still decides the range, while a bare "in
  // November" leaves the dates open instead of inventing a 30-day trip.
  const monthStart = monthAnchor(text, now);
  const startDate = dates[0] ?? (days !== undefined ? monthStart : undefined);
  let endDate: string | undefined = dates[1];
  if (startDate && !endDate && days && days > 0 && days <= MAX_INFERRED_DAYS) {
    endDate = addDays(startDate, days - 1) ?? undefined;
  }

  const pace = matchEnum(text, ['relaxed', 'steady', 'packed'] as const);
  const style = matchStyle(text);
  const interests = INTERESTS.filter((interest) => text.toLowerCase().includes(interest));

  return {
    destination: destination?.name,
    origin: origin?.[1],
    startDate,
    endDate,
    days,
    travelers: travelers
      ? Number(travelers[1])
      : forParty
        ? Number(forParty[1])
        : undefined,
    pace,
    style,
    interests,
    amount: amount ? Number(amount[1]) : undefined,
    fromCurrency: amount?.[2]?.toUpperCase(),
    toCurrency: toCurrency?.[1]?.toUpperCase(),
    passportCountry: passport?.[1]?.trim(),
    rememberText: extractRemember(text),
  };
}

/** How long the traveler said the trip is, in days. */
function lengthInDays(text: string): number | undefined {
  const counted = new RegExp(`\\b${COUNT_WORD}\\s*[- ]?\\s*(?:days?|nights?)\\b`, 'i').exec(
    text,
  );
  if (counted) return countFrom(counted[1]);
  const weeks = new RegExp(`\\b${COUNT_WORD}\\s*[- ]?\\s*weeks?\\b`, 'i').exec(text);
  const weekCount = weeks ? countFrom(weeks[1]) : undefined;
  if (weekCount) return weekCount * 7;
  if (/\bfortnight\b/i.test(text)) return 14;
  if (/\blong weekend\b/i.test(text)) return 3;
  if (/\bweekend\b/i.test(text)) return 2;
  return undefined;
}

function countFrom(word: string): number | undefined {
  const lower = word.toLowerCase();
  if (lower === 'a' || lower === 'an') return 1;
  return /^\d+$/.test(lower) ? Number(lower) : NUMBER_WORDS[lower];
}

/**
 * The first day of the month the traveler named, in the next year that has not
 * already started, so "in November" written in December means next November.
 */
function monthAnchor(text: string, now: Date): string | undefined {
  const lower = text.toLowerCase();
  const index = MONTHS.findIndex((month) => new RegExp(`\\b${month}\\b`).test(lower));
  if (index === -1) return undefined;
  const year = now.getUTCFullYear();
  const first = Date.UTC(year, index, 1);
  const thisMonth = Date.UTC(year, now.getUTCMonth(), 1);
  const chosen = first < thisMonth ? Date.UTC(year + 1, index, 1) : first;
  return new Date(chosen).toISOString().slice(0, 10);
}

function matchEnum<T extends string>(text: string, values: readonly T[]): T | undefined {
  const lower = text.toLowerCase();
  return values.find((value) => lower.includes(value));
}

function matchStyle(text: string): BudgetStyle | undefined {
  const lower = text.toLowerCase();
  if (/\b(splurge|luxury|nice hotel|high end)\b/.test(lower)) return 'splurge';
  if (/\b(comfortable|mid(?:-| )?(?:range|budget|tier)?|moderate|middling)\b/.test(lower)) {
    return 'comfortable';
  }
  // "lean" is matched last so "a cheap but comfortable hotel" stays comfortable.
  if (/\b(lean|cheap|budget|hostel|shoestring)\b/.test(lower)) return 'lean';
  return undefined;
}

export function extractRemember(text: string): string | undefined {
  const command = text.match(/^\/remember\s+([\s\S]+)$/i);
  if (command) return command[1].trim();
  const prefer = text.match(
    /\b(i (?:prefer|always|don't like|do not like|hate|love)\b[\s\S]{0,240})/i,
  );
  if (prefer) return prefer[1].trim().replace(/[.?!]$/, '');
  return undefined;
}
