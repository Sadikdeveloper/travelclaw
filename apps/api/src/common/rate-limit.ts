import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

/** Best guess at "who is calling" for a per-caller limiter when there is no account yet. */
export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** A 429 the client can recognise by code. Callers may replace the copy. */
export function rateLimited(
  message = 'Too many attempts. Wait a bit and try again.',
): HttpException {
  return new HttpException({ code: 'rate_limited', message }, HttpStatus.TOO_MANY_REQUESTS);
}
