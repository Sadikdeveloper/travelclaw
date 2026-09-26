import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

/** Best guess at "who is calling" for a per-caller limiter when there is no account yet. */
export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function rateLimited(): HttpException {
  return new HttpException(
    { code: 'rate_limited', message: 'Too many attempts. Wait a bit and try again.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
