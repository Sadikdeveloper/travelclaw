/**
 * Pairing auth — device token for non-loopback clients.
 *
 * A control UI running on the same machine (loopback) needs no extra step. A channel
 * bot, a CLI, or a second box calling this gateway over the network must present the
 * operator-configured device token on every request.
 *
 * This is a prerequisite before exposing the gateway past the host. It does NOT
 * replace account sign-in and vice-versa: both layers stack — pairing gates the
 * listener, the cookie/bearer session gates the account.
 *
 * The raw token is hashed in AppConfig at boot time; requests are compared against
 * the hash with timing-safe equality. The raw value never travels back out in error
 * bodies or logs.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Socket } from 'socket.io';
import { loadConfig } from '../config';

const PAIRING_HEADER = 'x-device-token';
const PAIRING_QUERY = 'deviceToken';

export const PAIRING_REQUIRED_CODE = 'pairing_required';
export const PAIRING_REQUIRED_MESSAGE_NO_TOKEN =
  'This gateway is bound to a non-loopback interface but no device token is configured. Set TRAVELCLAW_DEVICE_TOKEN to a long random string before exposing this port to the network, or bind HOST=127.0.0.1 for local-only use.';
export const PAIRING_REQUIRED_MESSAGE =
  'A device token is required for non-loopback clients. Send it in the X-Device-Token header (HTTP) or as the deviceToken query parameter (WebSocket).';

/** True when the given IP string is any form of loopback. */
export function isLoopback(raw: string | undefined): boolean {
  if (!raw) return false;
  const ip = raw.trim().toLowerCase();
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  // IPv4-mapped IPv6 loopback and the whole 127.0.0.0/8 block.
  const v4match = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4match) return v4match[1] === '127';
  return false;
}

/**
 * Effective client IP. When TRAVELCLAW_TRUST_PROXY=1, honours the leftmost entry in
 * X-Forwarded-For (the real client); otherwise req.ip from the TCP connection.
 */
export function clientIp(req: Pick<Request, 'ip' | 'headers'>): string | undefined {
  const cfg = loadConfig();
  if (cfg.trustProxy) {
    const raw = req.headers['x-forwarded-for'];
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (first) return first.split(',')[0]?.trim() || undefined;
  }
  return req.ip;
}

/** True when an HTTP request carries a valid X-Device-Token header. */
export function requestAuthorized(req: Pick<Request, 'headers'>): boolean {
  const cfg = loadConfig();
  if (!cfg.deviceTokenHash) return false;
  const presented = req.headers[PAIRING_HEADER];
  const token = Array.isArray(presented) ? presented[0] : presented;
  if (!token) return false;
  return hashMatches(token, cfg.deviceTokenHash);
}

/** True when a WebSocket handshake carries a valid deviceToken (query or header). */
export function socketAuthorized(socket: Socket): boolean {
  const cfg = loadConfig();
  if (!cfg.deviceTokenHash) return false;
  const rawQuery = socket.handshake.query?.[PAIRING_QUERY];
  const fromQuery = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;
  const rawHeader = socket.handshake.headers[PAIRING_HEADER];
  const fromHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const token = (fromQuery || fromHeader || '').toString();
  if (!token) return false;
  return hashMatches(token, cfg.deviceTokenHash);
}

/** True when the gateway has no device token set and therefore must refuse remotes. */
export function pairingNotConfigured(): boolean {
  return !loadConfig().deviceTokenHash;
}

function hashMatches(presented: string, expectedHash: string): boolean {
  const presentedHash = createHash('sha256').update(presented).digest();
  const expected = Buffer.from(expectedHash, 'hex');
  if (presentedHash.length !== expected.length) return false;
  return timingSafeEqual(presentedHash, expected);
}
