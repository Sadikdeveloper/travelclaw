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
import { sessionTokenOf } from './tokens';

/** Rejects anonymous callers on account-owned routes. Attaches `request.user`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: UserRecord }>();
    const user = readUser(request, this.auth);
    if (!user) {
      // A caller that presented a token has a stale session, not a reason to sign in —
      // the control UI recovers a lapsed guest silently and replays the request. "Sign in
      // to use this." is reserved for a caller that never had a session at all.
      const token = sessionTokenOf(request.headers, loadConfig().cookieName);
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
  return auth.verifyToken(sessionTokenOf(request.headers, loadConfig().cookieName));
}
