import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRecord } from '@travelclaw/shared';
import type { Request } from 'express';

/** Set by AuthGuard. Only usable on routes that carry the guard. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UserRecord => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: UserRecord }>();
    if (!request.user) {
      throw new Error('CurrentUser used without AuthGuard on the route');
    }
    return request.user;
  },
);
