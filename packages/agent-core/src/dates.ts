import { MAX_OUTLINE_DAYS } from '@travelclaw/shared';

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string | null {
  const date = parseIsoDate(iso);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function eachDate(start: string, end: string): string[] {
  const cursor = parseIsoDate(start);
  const last = parseIsoDate(end);
  if (!cursor || !last || cursor > last) {
    throw new Error('Date range is invalid');
  }
  const dates: string[] = [];
  while (cursor <= last && dates.length < MAX_OUTLINE_DAYS) {
    dates.push(formatIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function inclusiveDayCount(start: string, end: string): number {
  const cursor = parseIsoDate(start);
  const last = parseIsoDate(end);
  if (!cursor || !last || cursor > last) return 0;
  return Math.round((last.getTime() - cursor.getTime()) / 86_400_000) + 1;
}
