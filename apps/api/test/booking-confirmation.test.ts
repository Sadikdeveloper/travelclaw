import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookingConfirmationService } from '../src/browser/confirmation.service';
import { DatabaseService } from '../src/db/database.service';

/**
 * The traveler's recorded go-ahead, tested against the real table.
 *
 * This record is the only thing in the system that can authorize a browser run to
 * fill somebody's personal details, so its limits are the feature: one task, one
 * site, one epoch, ten minutes, spent by the first run that takes it. Every test
 * here is one of those limits.
 */
describe('booking confirmation', () => {
  let db: DatabaseService;
  let confirmations: BookingConfirmationService;
  const sessionId = 'session-1';
  const taskId = 'task-1';

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-confirm-'));
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.TRAVELCLAW_NETWORK = '1';
    db = new DatabaseService();
    db.onModuleInit();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO users (id, email, display_name, created_at, updated_at)
       VALUES ('user-1', 'traveler@example.com', 'Traveler', ?, ?)`,
      now,
      now,
    );
    db.run(
      `INSERT INTO sessions (id, key, user_id, agent_id, channel, peer_id, title, created_at, updated_at)
       VALUES (?, 'key-1', 'user-1', 'marlow', 'webchat', 'user-1', 'Trip', ?, ?)`,
      sessionId,
      now,
      now,
    );
    db.run(
      `INSERT INTO agent_tasks (id, session_id, kind, agent_name, status, summary, request, pass, created_at, updated_at)
       VALUES (?, ?, 'flight', 'Flight desk', 'awaiting', 'Found nothing.', 'KAD to LOS on 2026-11-02 for Ada Obi', 1, ?, ?)`,
      taskId,
      sessionId,
      now,
      now,
    );
    confirmations = new BookingConfirmationService(db);
  });

  afterAll(() => {
    db.onModuleDestroy();
  });

  beforeEach(() => {
    db.run('DELETE FROM booking_confirmations');
  });

  const record = () =>
    confirmations.record({
      sessionId,
      taskId,
      siteId: 'rano',
      summary: 'Fill the details you stated on Rano Air.',
    });

  it('records an approval bound to one task and one site', () => {
    const approval = record();
    expect(approval.taskId).toBe(taskId);
    expect(approval.siteId).toBe('rano');
    expect(approval.revokedAt).toBeNull();
    expect(approval.consumedBy).toBeNull();
    expect(confirmations.activeFor(taskId)?.epoch).toBe(approval.epoch);
    // Another task has no approval of its own, however recent this one is.
    expect(confirmations.activeFor('some-other-task')).toBeUndefined();
  });

  it('expires in ten minutes, checked rather than trusted', () => {
    const approval = record();
    expect(Date.parse(approval.expiresAt) - Date.parse(approval.createdAt)).toBe(
      10 * 60_000,
    );
    // Backdate past the TTL: the row is still there, the approval is not.
    db.run(
      'UPDATE booking_confirmations SET expires_at = ? WHERE id = ?',
      new Date(Date.now() - 1000).toISOString(),
      approval.id,
    );
    expect(confirmations.activeFor(taskId)).toBeUndefined();
    expect(confirmations.holds(taskId, approval.epoch)).toBe(false);
  });

  it('supersedes an earlier approval for the same task so only one is live', () => {
    const first = record();
    const second = record();
    expect(second.epoch).not.toBe(first.epoch);
    expect(confirmations.activeFor(taskId)?.id).toBe(second.id);
    // The first is revoked, not merely shadowed: presenting it must fail.
    expect(confirmations.holds(taskId, first.epoch)).toBe(false);
    expect(confirmations.holds(taskId, second.epoch)).toBe(true);
  });

  it('is spent by the first run that takes it', () => {
    const approval = record();
    expect(confirmations.consume(taskId, approval.epoch, 'run-1')).toBe(true);
    expect(confirmations.activeFor(taskId)).toBeUndefined();
    // A second run cannot reuse it. A fresh approval is the only way forward.
    expect(confirmations.consume(taskId, approval.epoch, 'run-2')).toBe(false);
    expect(confirmations.latestFor(taskId)?.consumedBy).toBe('run-1');
  });

  it('cannot be spent under an epoch it was not issued with', () => {
    record();
    expect(confirmations.consume(taskId, 'not-the-epoch', 'run-1')).toBe(false);
    // Nothing was consumed, so the real approval is still live.
    expect(confirmations.activeFor(taskId)).toBeDefined();
  });

  it('stops holding the moment it is revoked, and revoking twice is harmless', () => {
    const approval = record();
    expect(confirmations.holds(taskId, approval.epoch)).toBe(true);
    confirmations.revoke(taskId);
    expect(confirmations.holds(taskId, approval.epoch)).toBe(false);
    expect(confirmations.activeFor(taskId)).toBeUndefined();
    confirmations.revoke(taskId);
    expect(confirmations.latestFor(taskId)?.revokedAt).not.toBeNull();
  });

  it('keeps the record readable after it is spent or revoked', () => {
    const approval = record();
    confirmations.consume(taskId, approval.epoch, 'run-1');
    // `latestFor` is what the desk shows back; `activeFor` is what authorizes.
    // A spent approval must stay visible and stay unauthorized.
    expect(confirmations.latestFor(taskId)?.id).toBe(approval.id);
    expect(confirmations.activeFor(taskId)).toBeUndefined();
  });

  it('disappears with the chat it belongs to', () => {
    const approval = record();
    db.run('DELETE FROM sessions WHERE id = ?', sessionId);
    expect(confirmations.activeFor(taskId)).toBeUndefined();
    expect(confirmations.latestFor(taskId)).toBeUndefined();
    expect(approval.taskId).toBe(taskId);
  });
});
