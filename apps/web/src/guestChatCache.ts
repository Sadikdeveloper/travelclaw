import type { MessageRecord, SessionRecord } from '@travelclaw/shared';

/**
 * A guest has no account, so its chats are also mirrored into this browser's
 * localStorage — the server (under a lightweight, device-scoped guest identity) stays
 * the source of truth and is what actually runs each turn, but this cache lets the
 * sidebar and an open chat paint instantly on reload instead of waiting on a network
 * round trip, and gives the guest experience an obviously "on this device" feel.
 */

const PREFIX = 'travelclaw:guest:v1';
const MAX_SESSIONS = 30;
const MAX_MESSAGES = 200;

function sessionsKey(guestId: string): string {
  return `${PREFIX}:${guestId}:sessions`;
}

function messagesKey(guestId: string, sessionId: string): string {
  return `${PREFIX}:${guestId}:messages:${sessionId}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full, disabled, or private browsing — the server copy is still the
    // source of truth, so a mirror miss just costs a slightly slower first paint.
  }
}

/** Reads the cached chat list for a guest, or writes a fresh one when `sessions` is given. */
export function mirrorGuestSessions(guestId: string, sessions?: SessionRecord[]): SessionRecord[] {
  const key = sessionsKey(guestId);
  if (sessions) {
    writeJson(key, sessions.slice(0, MAX_SESSIONS));
    return sessions;
  }
  return readJson<SessionRecord[]>(key, []);
}

/** Reads a cached transcript, or writes a fresh one when `messages` is given. */
export function mirrorGuestMessages(
  guestId: string,
  sessionId: string,
  messages?: MessageRecord[],
): MessageRecord[] {
  const key = messagesKey(guestId, sessionId);
  if (messages) {
    writeJson(key, messages.slice(-MAX_MESSAGES));
    return messages;
  }
  return readJson<MessageRecord[]>(key, []);
}

/** Drops everything cached for a guest, once its chats have moved onto a real account. */
export function clearGuestCache(guestId: string): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(`${PREFIX}:${guestId}:`)) toRemove.push(key);
    }
    toRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
