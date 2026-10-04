import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  PAIRING_REQUIRED_CODE,
  PAIRING_REQUIRED_MESSAGE,
  PAIRING_REQUIRED_MESSAGE_NO_TOKEN,
  clientIp,
  isLoopback,
  pairingNotConfigured,
  requestAuthorized,
} from './pairing';

/**
 * Global middleware: every non-loopback HTTP caller must pair before any controller
 * (or auth guard) runs. /health is exempt so container/lb liveness checks work
 * without a token.
 *
 * NestMiddleware is preferred over APP_GUARD here so that the check fires even
 * before route-level guards, and so we can short-circuit cleanly with 401 + JSON.
 */
@Injectable()
export class PairingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Liveness probes never pair. Match /health, /health/, and /health?x=y.
    const url = req.originalUrl?.split('?')[0] ?? req.path;
    if (url === '/health' || url === '/health/') return next();

    const ip = clientIp(req);
    if (isLoopback(ip)) return next();

    // Non-loopback: need a configured token AND a matching header.
    if (pairingNotConfigured()) {
      return res.status(401).json({
        error: {
          code: PAIRING_REQUIRED_CODE,
          message: PAIRING_REQUIRED_MESSAGE_NO_TOKEN,
        },
      });
    }
    if (!requestAuthorized(req)) {
      return res.status(401).json({
        error: {
          code: PAIRING_REQUIRED_CODE,
          message: PAIRING_REQUIRED_MESSAGE,
        },
      });
    }
    next();
  }
}
