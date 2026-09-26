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
      throw new UnauthorizedException({
        code: 'unauthenticated',
        message: 'Sign in to use this.',
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
