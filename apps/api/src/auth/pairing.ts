/**
 * Pairing auth — device token for non-loopback clients.
 *
 * A direct loopback client (not a configured proxy) needs no extra step. A channel
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
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';
import type { Request } from 'express';
import type { Socket } from 'socket.io';
import { loadConfig } from '../config';

const PAIRING_HEADER = 'x-device-token';
const PAIRING_QUERY = 'deviceToken';

export const PAIRING_REQUIRED_CODE = 'pairing_required';
export const PAIRING_REQUIRED_MESSAGE_NO_TOKEN =
  'This request requires pairing but no device token is configured. Set TRAVELCLAW_DEVICE_TOKEN to a long random string before exposing this port to the network, or bind HOST=127.0.0.1 for local-only use.';
export const PAIRING_REQUIRED_MESSAGE =
  'A device token is required for remote or proxied clients. Send it in the X-Device-Token header (HTTP) or as the deviceToken query parameter (WebSocket).';

const matchesLoopback = proxyaddr.compile(['loopback']);

/** Only valid loopback addresses, including IPv4-mapped IPv6, qualify. */
export function isLoopback(raw: string | undefined): boolean {
  if (!raw || !isIP(raw)) return false;
  return matchesLoopback(raw, 0);
}

/**
 * Only a direct loopback TCP peer can skip pairing. Headers can REMOVE that
 * exemption, never grant it. A configured proxy must pair even if it drops XFF
 * or claims that its client was loopback. HTTP and WebSocket share this policy.
 */
export function isDirectLoopback(
  remoteAddress: string | undefined,
  headers: Request['headers'],
): boolean {
  if (!isLoopback(remoteAddress)) return false;
  if (
    ['x-forwarded-for', 'forwarded', 'x-real-ip'].some((key) => headers[key] !== undefined)
  ) {
    return false;
  }
  const { trustedProxies } = loadConfig();
  return !proxyaddr.compile(trustedProxies)(remoteAddress!, 0);
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
