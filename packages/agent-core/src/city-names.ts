import { DESTINATIONS } from './destinations';

/**
 * Common airport markets supplement the small set of cities with editorial desk
 * cards. This is a name-correction list, not an airport-code database: adapters
 * still resolve airport codes with their own lookup or an operator alias.
 */
const COMMON_CITIES = [
  'Abuja',
  'Accra',
  'Addis Ababa',
  'Amsterdam',
  'Ankara',
  'Athens',
  'Atlanta',
  'Auckland',
  'Austin',
  'Beijing',
  'Berlin',
  'Boston',
  'Brisbane',
  'Brussels',
  'Cairo',
  'Chicago',
  'Copenhagen',
  'Delhi',
  'Doha',
  'Dubai',
  'Dublin',
  'Frankfurt',
  'Freetown',
  'Hanoi',
  'Harare',
  'Helsinki',
  'Hong Kong',
  'Houston',
  'Jakarta',
  'Johannesburg',
  'Lagos',
  'Lima',
  'London',
  'Los Angeles',
  'Madrid',
  'Manila',
  'Miami',
  'Milan',
  'Montreal',
  'Moscow',
  'Mumbai',
  'Nairobi',
  'New York',
  'Osaka',
  'Paris',
  'Port Harcourt',
  'Prague',
  'Riyadh',
  'San Francisco',
  'Santiago',
  'Sao Paulo',
  'Seattle',
  'Shanghai',
  'Singapore',
  'Stockholm',
  'Sydney',
  'Taipei',
  'Tokyo',
  'Toronto',
  'Vienna',
  'Warsaw',
  'Washington',
  'Zurich',
] as const;

/** Common endonyms and spellings that should resolve without a confirmation turn. */
const EXTRA_ALIASES: Record<string, string> = {
  moskva: 'Moscow',
  'moscow city': 'Moscow',
  'sao paulo': 'Sao Paulo',
  'são paulo': 'Sao Paulo',
  'new york city': 'New York',
  nyc: 'New York',
  'port harcourt city': 'Port Harcourt',
  'lagos nigeria': 'Lagos',
  lisboa: 'Lisbon',
  marrakesh: 'Marrakech',
  reykjavík: 'Reykjavik',
  roma: 'Rome',
};

const CANONICAL_CITIES = unique([
  ...DESTINATIONS.map((destination) => destination.name),
  ...COMMON_CITIES,
]);

const ALIASES = new Map<string, string>();
for (const city of CANONICAL_CITIES) ALIASES.set(normalizeKey(city), city);
for (const destination of DESTINATIONS) {
  for (const alias of destination.aliases) {
    ALIASES.set(normalizeKey(alias), destination.name);
  }
}
for (const [alias, city] of Object.entries(EXTRA_ALIASES)) {
  ALIASES.set(normalizeKey(alias), city);
}

/**
 * Normalize a place phrase and correct a high-confidence one- or two-character
 * typo. Unknown/ambiguous names are preserved for the provider's own place lookup
 * instead of being silently replaced or forcing a confirmation turn.
 */
export function normalizeCityName(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/^[,.;:!?]+|[,.;:!?]+$/g, '');
  if (!trimmed) return undefined;

  // Preserve airport codes exactly as codes. A spelling correction must never
  // turn one three-letter location into another.
  if (/^[a-z]{3}$/i.test(trimmed)) return trimmed.toUpperCase();

  const key = normalizeKey(trimmed);
  const direct = ALIASES.get(key);
  if (direct) return direct;

  const candidateMatches = new Map<string, { distance: number; length: number }>();
  for (const [alias, city] of ALIASES) {
    if (alias.length < 4 || key.length < 4) continue;
    const distance = damerauLevenshtein(key, alias);
    const longer = Math.max(key.length, alias.length);
    const threshold = longer <= 6 ? 1 : 2;
    const transposition = isAdjacentTransposition(key, alias);
    const maxDistanceRatio = transposition ? 0.25 : 0.18;
    if (distance > threshold || distance / longer > maxDistanceRatio) continue;
    const current = candidateMatches.get(city);
    if (!current || distance < current.distance) {
      candidateMatches.set(city, { distance, length: longer });
    }
  }

  const ranked = [...candidateMatches.entries()].sort(
    ([, a], [, b]) => a.distance - b.distance || a.length - b.length,
  );
  const first = ranked[0];
  const second = ranked[1];
  if (first && (!second || second[1].distance > first[1].distance)) return first[0];
  return titleCase(trimmed);
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (/^[A-Z]{2,4}$/.test(word)) return word;
      return `${word.slice(0, 1).toLocaleUpperCase('en')}${word.slice(1).toLocaleLowerCase('en')}`;
    })
    .join(' ');
}

function isAdjacentTransposition(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length - 1; index += 1) {
    if (
      left[index] !== left[index + 1] &&
      left[index] === right[index + 1] &&
      left[index + 1] === right[index] &&
      left.slice(0, index) === right.slice(0, index) &&
      left.slice(index + 2) === right.slice(index + 2)
    ) {
      return true;
    }
  }
  return false;
}

/** Optimal string alignment distance, including one adjacent transposition. */
function damerauLevenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < columns; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const substitution = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + substitution,
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
