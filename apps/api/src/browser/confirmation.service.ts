import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BookingConfirmation } from '@travelclaw/shared';
import { DatabaseService } from '../db/database.service';

/**
 * How long one approval stays good for. Short on purpose: it covers a single
 * browser run (which is capped at two minutes) with room for the traveler to read
 * the card and press the button, and no longer. An approval that could sit unused
 * for an hour would be a standing authorization, which is the thing this whole
 * design is trying not to create.
 */
const TTL_MS = 10 * 60_000;

interface Row {
  id: string;
  session_id: string;
  task_id: string;
  site_id: string;
  epoch: string;
  summary: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  consumed_by: string | null;
}

function map(row: Row): BookingConfirmation {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    siteId: row.site_id,
    epoch: row.epoch,
    summary: row.summary,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    consumedBy: row.consumed_by,
  };
}

/**
 * The traveler's recorded go-ahead for a browser run to fill their details.
 *
 * This is the only place `bookingConfirmed` can come from. The worker grants its
 * booking tier on a conjunction — the operator's site scope AND this record — and
 * nothing in a request body can assert either half.
 *
 * Two properties the rest of the system leans on:
 *
 * - **A record is not a session flag.** It carries an `epoch`, so the run that
 *   started under one approval cannot be silently re-authorized by a later one.
 *   `holds()` is what the lease fence asks before and after every worker call.
 * - **One approval, one run.** `consume()` spends it. A second run needs the
 *   traveler to approve again, because they are approving a specific fill on a
 *   specific site, not a standing permission for their details.
 */
@Injectable()
export class BookingConfirmationService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Record an approval for `taskId` on `siteId`, superseding any earlier one for
   * the same task so at most one is ever live.
   */
  record(input: {
    sessionId: string;
    taskId: string;
    siteId: string;
    summary: string;
  }): BookingConfirmation {
    const now = Date.now();
    this.db.run(
      'UPDATE booking_confirmations SET revoked_at = ? WHERE task_id = ? AND revoked_at IS NULL',
      new Date(now).toISOString(),
      input.taskId,
    );
    const row: Row = {
      id: randomUUID(),
      session_id: input.sessionId,
      task_id: input.taskId,
      site_id: input.siteId,
      epoch: randomUUID(),
      summary: input.summary,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + TTL_MS).toISOString(),
      revoked_at: null,
      consumed_by: null,
    };
    this.db.run(
      'INSERT INTO booking_confirmations (id, session_id, task_id, site_id, epoch, summary, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      row.id,
      row.session_id,
      row.task_id,
      row.site_id,
      row.epoch,
      row.summary,
      row.created_at,
      row.expires_at,
    );
    return map(row);
  }

  /** The live approval for a task, if there is one. Expiry is checked, not trusted. */
  activeFor(taskId: string): BookingConfirmation | undefined {
    const row = this.db.get<Row>(
      `SELECT * FROM booking_confirmations
       WHERE task_id = ? AND revoked_at IS NULL AND consumed_by IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      taskId,
    );
    if (!row) return undefined;
    if (Date.parse(row.expires_at) <= Date.now()) return undefined;
    return map(row);
  }

  /**
   * Whether this exact approval is still the one in force.
   *
   * This is the fence check, and it is asked twice per worker call: once before,
   * so a withdrawn approval stops the run, and once after, so a result that
   * arrived *while* the approval was being withdrawn is voided rather than
   * reported. A mismatch of epoch counts as withdrawn even if the newer approval
   * is valid — a run authorized by epoch A is not authorized by epoch B.
   */
  holds(taskId: string, epoch: string): boolean {
    const row = this.db.get<Row>(
      'SELECT * FROM booking_confirmations WHERE task_id = ? AND epoch = ?',
      taskId,
      epoch,
    );
    if (!row) return false;
    if (row.revoked_at) return false;
    return Date.parse(row.expires_at) > Date.now();
  }

  /** Spend this approval on a run. Returns false if it was already spent or lapsed. */
  consume(taskId: string, epoch: string, runId: string): boolean {
    const before = this.db.get<{ consumed_by: string | null; revoked_at: string | null }>(
      'SELECT consumed_by, revoked_at FROM booking_confirmations WHERE task_id = ? AND epoch = ?',
      taskId,
      epoch,
    );
    if (!before || before.consumed_by || before.revoked_at) return false;
    // The WHERE clause repeats the guard, so two runs racing for one approval
    // cannot both believe they won it.
    this.db.run(
      'UPDATE booking_confirmations SET consumed_by = ? WHERE task_id = ? AND epoch = ? AND consumed_by IS NULL AND revoked_at IS NULL',
      runId,
      taskId,
      epoch,
    );
    return this.holds(taskId, epoch);
  }

  /** Withdraw every live approval for a task. Idempotent; safe to call twice. */
  revoke(taskId: string): void {
    this.db.run(
      'UPDATE booking_confirmations SET revoked_at = ? WHERE task_id = ? AND revoked_at IS NULL',
      new Date().toISOString(),
      taskId,
    );
  }

  /** What the UI shows back: the live approval, or the most recent one if none. */
  latestFor(taskId: string): BookingConfirmation | undefined {
    const row = this.db.get<Row>(
      'SELECT * FROM booking_confirmations WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      taskId,
    );
    return row ? map(row) : undefined;
  }
}
