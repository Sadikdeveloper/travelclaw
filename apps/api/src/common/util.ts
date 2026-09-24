import { randomUUID } from 'node:crypto';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function addInterval(from: Date, every: string): Date {
  const match = /^(\d+)(m|h|d)$/.exec(every.trim());
  const next = new Date(from);
  if (!match) {
    next.setUTCMinutes(next.getUTCMinutes() + 30);
    return next;
  }
  const amount = Number(match[1]);
  if (match[2] === 'm') next.setUTCMinutes(next.getUTCMinutes() + amount);
  if (match[2] === 'h') next.setUTCHours(next.getUTCHours() + amount);
  if (match[2] === 'd') next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

export function slug(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return base || 'agent';
}

export function titleFrom(text: string): string {
  const clean = text.replace(/^\/\w+\s*/, '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New desk note';
  return clean.length > 52 ? `${clean.slice(0, 52)}…` : clean;
}
