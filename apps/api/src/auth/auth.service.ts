import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { UserRecord } from '@travelclaw/shared';
import { newId, nowIso } from '../common/util';
import { loadConfig } from '../config';
import { DatabaseService } from '../db/database.service';
import { hashPassword, verifyPassword } from './password';
import { RateLimiter } from './rate-limiter';
import { hashToken, newSessionToken } from './tokens';

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  google_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthSessionRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface AuthResult {
  user: UserRecord;
  token: string;
  expiresAt: Date;
}

interface GoogleTokenInfo {
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  sub?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** 10 attempts per 10 minutes per key is generous for a real traveler, punishing for a script. */
  readonly loginLimiter = new RateLimiter(10, 10 * 60 * 1000);
  readonly registerLimiter = new RateLimiter(10, 60 * 60 * 1000);

  constructor(private readonly db: DatabaseService) {}

  register(email: string, password: string, displayName?: string): AuthResult {
    const existing = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
    if (existing) {
      throw new ConflictException({
        code: 'email_taken',
        message: 'An account with that email already exists.',
      });
    }
    const now = nowIso();
    const id = newId();
    const name = (displayName || '').trim() || email.split('@')[0];
    this.db.run(
      `INSERT INTO users (id, email, password_hash, display_name, google_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      id,
      email,
      hashPassword(password),
      name,
      now,
      now,
    );
    const row = this.getRowById(id);
    return this.issueSession(row);
  }

  login(email: string, password: string): AuthResult {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
    // Same generic failure whether the email is unknown, the password is wrong, or the
    // account has no password (Google-only) — anything else tells an attacker the email exists.
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'That email and password do not match.',
      });
    }
    return this.issueSession(row);
  }

  async loginWithGoogle(credential: string): Promise<AuthResult> {
    const config = loadConfig();
    if (!config.googleClientId) {
      throw new ServiceUnavailableException({
        code: 'google_not_configured',
        message: 'Google sign-in is not enabled on this desk.',
      });
    }
    if (!config.network) {
      throw new ServiceUnavailableException({
        code: 'network_disabled',
        message: 'Google sign-in needs network access, which is off right now.',
      });
    }
    const info = await this.verifyGoogleCredential(credential);
    if (info.aud !== config.googleClientId) {
      throw new UnauthorizedException({
        code: 'google_audience_mismatch',
        message: 'That Google credential was not issued for this desk.',
      });
    }
    if (info.email_verified !== true && info.email_verified !== 'true') {
      throw new UnauthorizedException({
        code: 'google_email_unverified',
        message: 'That Google account has no verified email.',
      });
    }
    if (!info.sub || !info.email) {
      throw new UnauthorizedException({
        code: 'google_invalid_token',
        message: 'That Google credential is missing required claims.',
      });
    }
    const email = info.email.trim().toLowerCase();
    const bySub = this.db.get<UserRow>('SELECT * FROM users WHERE google_id = ?', info.sub);
    if (bySub) return this.issueSession(bySub);

    const byEmail = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
    const now = nowIso();
    if (byEmail) {
      // Same email already registered by password. Google verified this email, so link
      // the accounts instead of creating a second row a traveler would not recognize.
      this.db.run(
        'UPDATE users SET google_id = ?, updated_at = ? WHERE id = ?',
        info.sub,
        now,
        byEmail.id,
      );
      return this.issueSession(this.getRowById(byEmail.id));
    }

    const id = newId();
    this.db.run(
      `INSERT INTO users (id, email, password_hash, display_name, google_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      id,
      email,
      (info.name || '').trim() || email.split('@')[0],
      info.sub,
      now,
      now,
    );
    return this.issueSession(this.getRowById(id));
  }

  logout(token: string) {
    this.db.run('DELETE FROM auth_sessions WHERE id = ?', hashToken(token));
  }

  /** Returns null for a missing, expired, or unknown token rather than throwing — callers decide. */
  verifyToken(token: string | undefined | null): UserRecord | null {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = this.db.get<AuthSessionRow>(
      'SELECT * FROM auth_sessions WHERE id = ?',
      tokenHash,
    );
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.db.run('DELETE FROM auth_sessions WHERE id = ?', tokenHash);
      return null;
    }
    const user = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.user_id);
    if (!user) {
      this.db.run('DELETE FROM auth_sessions WHERE id = ?', tokenHash);
      return null;
    }
    return mapUser(user);
  }

  private issueSession(row: UserRow): AuthResult {
    const token = newSessionToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + loadConfig().sessionTtlDays * 24 * 60 * 60 * 1000,
    );
    this.db.run(
      'INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      hashToken(token),
      row.id,
      now.toISOString(),
      expiresAt.toISOString(),
    );
    return { user: mapUser(row), token, expiresAt };
  }

  private getRowById(id: string): UserRow {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    if (!row) throw new Error(`User ${id} vanished after write`);
    return row;
  }

  private async verifyGoogleCredential(credential: string): Promise<GoogleTokenInfo> {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      this.logger.error('Google tokeninfo request failed', error);
      throw new ServiceUnavailableException({
        code: 'google_unreachable',
        message: 'Could not reach Google to verify that credential.',
      });
    }
    if (!response.ok) {
      throw new UnauthorizedException({
        code: 'google_invalid_token',
        message: 'Google rejected that credential.',
      });
    }
    return (await response.json()) as GoogleTokenInfo;
  }
}

export function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    hasPassword: Boolean(row.password_hash),
    hasGoogle: Boolean(row.google_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
