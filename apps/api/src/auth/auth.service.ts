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
import { GoogleTokenError, verifyGoogleIdToken } from './google-verify';
import { hashPassword, isLegacyScryptHash, verifyPassword } from './password';
import { RateLimiter } from './rate-limiter';
import { hashToken, newSessionToken } from './tokens';

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  google_id: string | null;
  is_guest: number;
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

/**
 * New guest sessions allowed from one address per hour. Deliberately loose: the control UI
 * mints a guest per browser profile, a household shares one address, and a desktop behind a
 * reverse proxy can look like a single caller. What actually bounds cost is the per-guest
 * and per-IP turn limits in `ChatController`, so this only has to stop a mint flood.
 */
export const GUEST_MINTS_PER_IP_PER_HOUR = 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** 10 attempts per 10 minutes per key is generous for a real traveler, punishing for a script. */
  readonly loginLimiter = new RateLimiter(10, 10 * 60 * 1000);
  readonly registerLimiter = new RateLimiter(10, 60 * 60 * 1000);
  /**
   * Guest accounts need no password and no email confirmation, so per-IP creation is
   * the only real brake on someone minting thousands of them to dodge other limits.
   */
  readonly guestLimiter = new RateLimiter(GUEST_MINTS_PER_IP_PER_HOUR, 60 * 60 * 1000);

  constructor(private readonly db: DatabaseService) {}

  /** A no-signup, device-local identity: real enough to own chats, nothing to leak if abandoned. */
  async createGuest(): Promise<AuthResult> {
    const now = nowIso();
    const id = newId();
    // Never shown in the UI and never a login target — just a unique key for the UNIQUE(email) column.
    const email = `guest-${id}@guest.travelclaw.local`;
    this.db.run(
      `INSERT INTO users (id, email, password_hash, display_name, google_id, is_guest, created_at, updated_at)
       VALUES (?, ?, NULL, ?, NULL, 1, ?, ?)`,
      id,
      email,
      'Guest',
      now,
      now,
    );
    return this.issueSession(this.getRowById(id));
  }

  async register(
    email: string,
    password: string,
    displayName?: string,
    guestId?: string,
  ): Promise<AuthResult> {
    const existing = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
    if (existing) {
      throw new ConflictException({
        code: 'email_taken',
        message: 'An account with that email already exists.',
      });
    }
    const now = nowIso();
    const name = (displayName || '').trim() || email.split('@')[0];
    const passwordHash = await hashPassword(password);
    const guest = this.findGuest(guestId);
    if (guest) {
      // Turn the guest's own row into the real account instead of creating a second one —
      // its chats already carry this id, so they come along for free, no data to move.
      this.db.run(
        'UPDATE users SET email = ?, password_hash = ?, display_name = ?, is_guest = 0, updated_at = ? WHERE id = ?',
        email,
        passwordHash,
        name,
        now,
        guest.id,
      );
      return this.issueSession(this.getRowById(guest.id));
    }
    const id = newId();
    this.db.run(
      `INSERT INTO users (id, email, password_hash, display_name, google_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      id,
      email,
      passwordHash,
      name,
      now,
      now,
    );
    const row = this.getRowById(id);
    return this.issueSession(row);
  }

  async login(email: string, password: string, guestId?: string): Promise<AuthResult> {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
    // Same generic failure whether the email is unknown, the password is wrong, or the
    // account has no password (Google-only) — anything else tells an attacker the email exists.
    const valid = await verifyPassword(password, row?.password_hash ?? null);
    if (!row || !valid) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'That email and password do not match.',
      });
    }
    this.absorbGuest(guestId, row.id);
    // Quiet algorithm migration: a hash written before Argon2id was wired up upgrades
    // to it the next time its owner successfully signs in, with no action from them.
    if (isLegacyScryptHash(row.password_hash)) {
      const upgraded = await hashPassword(password);
      this.db.run(
        'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
        upgraded,
        nowIso(),
        row.id,
      );
      return this.issueSession(this.getRowById(row.id));
    }
    return this.issueSession(this.getRowById(row.id));
  }

  async loginWithGoogle(credential: string, guestId?: string): Promise<AuthResult> {
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
    const claims = await this.verifyGoogleCredential(credential);
    if (claims.aud !== config.googleClientId) {
      throw new UnauthorizedException({
        code: 'google_audience_mismatch',
        message: 'That Google credential was not issued for this desk.',
      });
    }
    if (!claims.emailVerified) {
      throw new UnauthorizedException({
        code: 'google_email_unverified',
        message: 'That Google account has no verified email.',
      });
    }
    const email = claims.email.trim().toLowerCase();
    const bySub = this.db.get<UserRow>(
      'SELECT * FROM users WHERE google_id = ?',
      claims.sub,
    );
    if (bySub) {
      this.absorbGuest(guestId, bySub.id);
      return this.issueSession(this.getRowById(bySub.id));
    }

    const byEmail = this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
    const now = nowIso();
    if (byEmail) {
      // Same email already registered by password. Google verified this email, so link
      // the accounts instead of creating a second row a traveler would not recognize.
      this.db.run(
        'UPDATE users SET google_id = ?, updated_at = ? WHERE id = ?',
        claims.sub,
        now,
        byEmail.id,
      );
      this.absorbGuest(guestId, byEmail.id);
      return this.issueSession(this.getRowById(byEmail.id));
    }

    const name = (claims.name || '').trim() || email.split('@')[0];
    const guest = this.findGuest(guestId);
    if (guest) {
      // Same trick as register(): keep the guest's own row (and its chats) and just
      // promote it, instead of inserting a second row and moving everything over.
      this.db.run(
        'UPDATE users SET email = ?, display_name = ?, google_id = ?, is_guest = 0, updated_at = ? WHERE id = ?',
        email,
        name,
        claims.sub,
        now,
        guest.id,
      );
      return this.issueSession(this.getRowById(guest.id));
    }

    const id = newId();
    this.db.run(
      `INSERT INTO users (id, email, password_hash, display_name, google_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      id,
      email,
      name,
      claims.sub,
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

  private findGuest(guestId: string | undefined): UserRow | undefined {
    if (!guestId) return undefined;
    return this.db.get<UserRow>(
      'SELECT * FROM users WHERE id = ? AND is_guest = 1',
      guestId,
    );
  }

  /**
   * Folds a guest's chats into the account they just signed into (register()/loginWithGoogle()
   * handle the "guest becomes a brand-new account" case themselves by promoting the guest row
   * in place — this only fires when the caller lands on a *different*, already-existing row).
   * Never touches the guest row on a failed sign-in attempt, so a mistyped password cannot
   * lose someone's guest chats.
   */
  private absorbGuest(guestId: string | undefined, targetUserId: string): void {
    if (!guestId || guestId === targetUserId) return;
    const guest = this.findGuest(guestId);
    if (!guest) return;
    try {
      this.db.run(
        'UPDATE sessions SET user_id = ? WHERE user_id = ?',
        targetUserId,
        guestId,
      );
    } catch (error) {
      this.logger.warn(`Could not fold guest ${guestId} chats into ${targetUserId}`, error);
      return;
    }
    this.db.run('DELETE FROM users WHERE id = ? AND is_guest = 1', guestId);
  }

  private async verifyGoogleCredential(credential: string) {
    try {
      return await verifyGoogleIdToken(credential);
    } catch (error) {
      if (error instanceof GoogleTokenError) {
        if (error.code === 'jwks_unreachable') {
          throw new ServiceUnavailableException({
            code: 'google_unreachable',
            message: 'Could not reach Google to verify that credential.',
          });
        }
        throw new UnauthorizedException({
          code: 'google_invalid_token',
          message: 'Google rejected that credential.',
        });
      }
      throw error;
    }
  }
}

export function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    hasPassword: Boolean(row.password_hash),
    hasGoogle: Boolean(row.google_id),
    isGuest: Boolean(row.is_guest),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
