import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { UserRecord } from '@travelclaw/shared';
import type { Request } from 'express';
import { loadConfig } from '../config';
import { AuthService } from './auth.service';
import { parseCookies } from './tokens';

/** Rejects anonymous callers on account-owned routes. Attaches `request.user`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: UserRecord }>();
    const user = readUser(request, this.auth);
    if (!user) {
      // A caller that sent a cookie has a stale session, not a reason to sign in — the
      // control UI recovers a lapsed guest silently and replays the request. "Sign in to
      // use this." is reserved for a caller that never had a session at all.
      const token = parseCookies(request.headers.cookie)[loadConfig().cookieName];
      throw new UnauthorizedException({
        code: 'unauthenticated',
        message: token
          ? 'That session has expired. Sign in again.'
          : 'Sign in to use this.',
      });
    }
    request.user = user;
    return true;
  }
}

/** Reusable by routes and sockets that want a user when present but must not require one. */
export function readUser(
  request: Request & { user?: UserRecord },
  auth: AuthService,
): UserRecord | null {
  const config = loadConfig();
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[config.cookieName];
  return auth.verifyToken(token);
}
