import type { BudgetStyle } from '@travelclaw/shared';
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

export function extractHints(text: string): TripHints {
  const dates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  const dayCount = text.match(/\b(\d{1,2})\s*[- ]?days?\b/i);
  const travelers = text.match(/\b(\d{1,2})\s*(travelers|travellers|people|adults|guests)\b/i);
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

  const startDate = dates[0];
  let endDate: string | undefined = dates[1];
  const days = dayCount ? Number(dayCount[1]) : undefined;
  if (startDate && !endDate && days && days > 0 && days <= 18) {
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
    travelers: travelers ? Number(travelers[1]) : forParty ? Number(forParty[1]) : undefined,
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

function matchEnum<T extends string>(text: string, values: readonly T[]): T | undefined {
  const lower = text.toLowerCase();
  return values.find((value) => lower.includes(value));
}

function matchStyle(text: string): BudgetStyle | undefined {
  const lower = text.toLowerCase();
  if (/\b(lean|cheap|budget|hostel)\b/.test(lower)) return 'lean';
  if (/\b(splurge|luxury|nice hotel|high end)\b/.test(lower)) return 'splurge';
  if (/\bcomfortable\b/.test(lower)) return 'comfortable';
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
