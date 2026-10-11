import { createHash } from 'node:crypto';
import {
  SITE_NOTE_REASONS,
  browserSiteNoteSchema,
  type BrowserHandoffReason,
  type BrowserSiteNote,
  type BrowserSiteNoteKind,
} from '@travelclaw/shared';
import type { DatabaseService } from '../db/database.service';

interface Row {
  id: string;
  site_id: string;
  origin: string;
  kind: string;
  note_origin: string;
  runs: number;
  review_status: string;
  first_seen_at: string;
  last_seen_at: string;
  reviewed_at: string | null;
}

function map(row: Row): BrowserSiteNote {
  return browserSiteNoteSchema.parse({
    id: row.id,
    siteId: row.site_id,
    origin: row.origin,
    kind: row.kind,
    noteOrigin: row.note_origin,
    runs: row.runs,
    reviewStatus: row.review_status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    reviewedAt: row.reviewed_at,
  });
}

/**
 * Record that a site stopped a run, so the next one does not have to rediscover it.
 *
 * This is the counterpart to `proposeProcedure`: procedures learn the shape of a
 * run that worked, notes learn what stopped one. Without notes the desk hits the
 * same cookie wall on every attempt and reports the same surprise each time.
 *
 * Three properties are load-bearing:
 *
 * - **The kind is chosen from the handoff reason, never from page text.** Only
 *   reasons that describe the site qualify; our own budgets and the traveler's
 *   missing details do not, so a note is never an echo of the request.
 * - **One row per site and blocker.** Repeats raise `runs` rather than adding
 *   rows, so the table is bounded by the vocabulary instead of by traffic, and the
 *   count is the useful part: "seen four times" is evidence, "seen once" is noise.
 * - **A review is not reset by a repeat.** A blocker an operator already approved
 *   or rejected keeps that verdict; a new sighting only moves `last_seen_at` and
 *   `runs`. Otherwise a rejected note would silently return to pending and could
 *   be approved by accident.
 */
export function proposeSiteNote(
  db: DatabaseService,
  input: { siteId: string; origin: string; reason: BrowserHandoffReason; at: string },
): BrowserSiteNote | undefined {
  const mapped = SITE_NOTE_REASONS[input.reason];
  if (!mapped) return undefined;
  const { kind, origin: noteOrigin } = mapped;
  const id = createHash('sha256')
    .update(`${input.siteId}\u0000${input.origin}\u0000${kind}`)
    .digest('hex')
    .slice(0, 24);
  const existing = db.get<Row>('SELECT * FROM browser_site_notes WHERE id = ?', id);
  if (existing) {
    db.run(
      'UPDATE browser_site_notes SET runs = MIN(runs + 1, 100000), last_seen_at = ? WHERE id = ?',
      input.at,
      id,
    );
    return map(db.get<Row>('SELECT * FROM browser_site_notes WHERE id = ?', id)!);
  }
  db.run(
    `INSERT INTO browser_site_notes
       (id, site_id, origin, kind, note_origin, runs, review_status, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, 1, 'pending', ?, ?)`,
    id,
    input.siteId,
    input.origin,
    kind,
    noteOrigin,
    input.at,
    input.at,
  );
  return map(db.get<Row>('SELECT * FROM browser_site_notes WHERE id = ?', id)!);
}

/**
 * The notes an operator has approved for this site and origin.
 *
 * Pending and rejected notes are invisible here. A `page_claimed` note is only
 * ever supplied after review, which is what stops a site from planting a durable
 * claim about itself in one visit and having the desk repeat it forever after.
 */
export function reviewedSiteNotes(
  db: DatabaseService,
  siteId: string,
  origin: string,
): Array<Pick<BrowserSiteNote, 'kind' | 'noteOrigin' | 'runs'>> {
  return (
    db
      .all<Row>(
        `SELECT * FROM browser_site_notes
       WHERE site_id = ? AND origin = ? AND review_status = 'approved'
       ORDER BY runs DESC, last_seen_at DESC LIMIT 5`,
        siteId,
        origin,
      )
      .map((row) => map(row))
      // Re-validated above by `map`; a row that no longer fits the schema is dropped
      // rather than passed to the model.
      .filter((note): note is BrowserSiteNote => !!note)
      .map(({ kind, noteOrigin, runs }) => ({ kind, noteOrigin, runs }))
  );
}

/** One line of copy per blocker, so the desk says the same thing every time. */
export function siteNoteCopy(kind: BrowserSiteNoteKind): string {
  const copy: Record<BrowserSiteNoteKind, string> = {
    consent_wall: 'a consent or cookie wall the browser will not dismiss',
    sign_in_wall: 'a sign-in form the browser will not fill',
    human_verification: 'a human-verification step (CAPTCHA) the browser will not bypass',
    refused_access:
      'refused automated access (blocked, rate-limited, or opened another window)',
    content_too_large: 'pages too large for the browser budget',
  };
  return copy[kind];
}
