import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

/** Best guess at "who is calling" for a per-caller limiter when there is no account yet. */
export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * A browser that can hold no credential — a cross-site frame with cookies and storage both
 * blocked — is recognised by where it calls from and what it calls with. Coarser than a
 * session, so it is only ever consulted when a caller presents nothing at all.
 */
export function browserKey(req: Request): string {
  return `${clientKey(req)}|${req.headers['user-agent'] || ''}`;
}

/** A 429 the client can recognise by code. Callers may replace the copy. */
export function rateLimited(
  message = 'Too many attempts. Wait a bit and try again.',
): HttpException {
  return new HttpException({ code: 'rate_limited', message }, HttpStatus.TOO_MANY_REQUESTS);
}
