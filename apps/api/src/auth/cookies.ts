import type { Response } from 'express';
import { loadConfig } from '../config';

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  const config = loadConfig();
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  const config = loadConfig();
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  });
}
