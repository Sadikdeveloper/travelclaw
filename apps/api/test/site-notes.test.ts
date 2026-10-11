import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserHandoffReason } from '@travelclaw/shared';
import { DatabaseService } from '../src/db/database.service';
import {
  proposeSiteNote,
  reviewedSiteNotes,
  siteNoteCopy,
} from '../src/browser/site-notes';

/**
 * Site notes: what a site reliably does to a browser run.
 *
 * The interesting risk here is not the table, it is the source of the claim. A
 * blocker the worker observed structurally is a fact about the site; a blocker
 * matched out of the page's own text is something the page said about itself, and
 * a hostile page would happily say it in order to leave a durable, replayed lie
 * behind. Every test below is one half of that distinction or one limit on it.
 */
describe('browser site notes', () => {
  let db: DatabaseService;
  const siteId = 'fixture';
  const origin = 'https://fixture.test';
  const at = '2026-10-11T12:00:00.000Z';

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-notes-'));
    process.env.DATABASE_PATH = join(dir, 'test.db');
    process.env.TRAVELCLAW_NETWORK = '1';
    db = new DatabaseService();
    db.onModuleInit();
  });

  afterAll(() => {
    db.onModuleDestroy();
  });

  beforeEach(() => {
    db.run('DELETE FROM browser_site_notes');
  });

  const note = (reason: BrowserHandoffReason, when = at) =>
    proposeSiteNote(db, { siteId, origin, reason, at: when });

  it('records a structural blocker as observed by the worker', () => {
    const saved = note('sign_in');
    expect(saved).toMatchObject({
      siteId,
      origin,
      kind: 'sign_in_wall',
      noteOrigin: 'worker_observed',
      runs: 1,
      reviewStatus: 'pending',
    });
  });

  it.each([
    ['consent', 'consent_wall'],
    ['verification', 'human_verification'],
  ] as const)(
    'quarantines %s as a page claim, because the worker matches it in page text',
    (reason, kind) => {
      // Both of these can also come from a real dialog or a visible control, and
      // the gateway cannot tell which from the reason alone. When it cannot tell,
      // the untrusted origin is the one that must stick.
      expect(note(reason)).toMatchObject({ kind, noteOrigin: 'page_claimed' });
    },
  );

  it.each([
    'time_limit',
    'action_limit',
    'network_restriction',
    'missing_information',
    'ambiguous_form',
    'confirmation_required',
    'human_has_control',
    'cancelled',
    'stale_snapshot',
    'invalid_action',
    'worker_unavailable',
    'model_unavailable',
  ] as const)('records nothing for %s, which is not a fact about the site', (reason) => {
    expect(note(reason)).toBeUndefined();
    expect(db.all('SELECT * FROM browser_site_notes')).toHaveLength(0);
  });

  it('counts repeats on one row instead of growing the table', () => {
    note('consent');
    note('consent', '2026-10-11T12:05:00.000Z');
    const third = note('consent', '2026-10-11T12:09:00.000Z');
    expect(db.all('SELECT * FROM browser_site_notes')).toHaveLength(1);
    expect(third).toMatchObject({ runs: 3, firstSeenAt: at, lastSeenAt: '2026-10-11T12:09:00.000Z' });
  });

  it('keeps separate rows per site, per origin, and per blocker', () => {
    note('consent');
    note('sign_in');
    proposeSiteNote(db, { siteId: 'other', origin, reason: 'consent', at });
    proposeSiteNote(db, { siteId, origin: 'https://elsewhere.test', reason: 'consent', at });
    // Two blockers for this site, plus one each for another site and another origin.
    expect(db.all('SELECT * FROM browser_site_notes')).toHaveLength(4);
  });

  it('never supplies a note before an operator approves it', () => {
    note('consent');
    expect(reviewedSiteNotes(db, siteId, origin)).toEqual([]);
    db.run("UPDATE browser_site_notes SET review_status = 'approved' WHERE site_id = ?", siteId);
    expect(reviewedSiteNotes(db, siteId, origin)).toEqual([
      { kind: 'consent_wall', noteOrigin: 'page_claimed', runs: 1 },
    ]);
  });

  it('never supplies a rejected note, however often it recurs', () => {
    const saved = note('consent')!;
    db.run("UPDATE browser_site_notes SET review_status = 'rejected' WHERE id = ?", saved.id);
    note('consent', '2026-10-11T12:05:00.000Z');
    note('consent', '2026-10-11T12:06:00.000Z');
    expect(reviewedSiteNotes(db, siteId, origin)).toEqual([]);
    // A repeat must not quietly return a rejected note to pending, where it could
    // be approved by accident on the next review pass.
    const row = db.get<{ review_status: string; runs: number }>(
      'SELECT review_status, runs FROM browser_site_notes WHERE id = ?',
      saved.id,
    )!;
    expect(row.review_status).toBe('rejected');
    expect(row.runs).toBe(3);
  });

  it('supplies the most-repeated blockers first and caps the list', () => {
    for (const [reason, times] of [
      ['consent', 4],
      ['sign_in', 2],
      ['site_restriction', 3],
      ['page_limit', 1],
      ['verification', 5],
    ] as const) {
      for (let i = 0; i < times; i++) note(reason);
    }
    db.run("UPDATE browser_site_notes SET review_status = 'approved'");
    const notes = reviewedSiteNotes(db, siteId, origin);
    expect(notes).toHaveLength(5);
    expect(notes.map((n) => n.runs)).toEqual([5, 4, 3, 2, 1]);
    expect(notes[0].kind).toBe('human_verification');
  });

  it('says the same thing about a blocker every time', () => {
    expect(siteNoteCopy('consent_wall')).toContain('consent');
    expect(siteNoteCopy('human_verification')).toContain('will not bypass');
    // No blocker may be described as something TravelClaw could fix by trying again.
    for (const kind of [
      'consent_wall',
      'sign_in_wall',
      'human_verification',
      'refused_access',
      'content_too_large',
    ] as const) {
      expect(siteNoteCopy(kind).length).toBeGreaterThan(10);
      expect(siteNoteCopy(kind)).not.toMatch(/retry|try again|temporary/i);
    }
  });
});
