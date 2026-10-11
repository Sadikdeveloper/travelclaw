// Operator-only maintenance command. Deliberately NOT an HTTP or model tool.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { browserSiteNoteSchema } from '@travelclaw/shared';
const [command = 'list', id] = process.argv.slice(2);
if (!['list', 'approve', 'reject'].includes(command))
  throw new Error('Use list, approve <id>, or reject <id>.');
const path = resolve(process.env.DATABASE_PATH || '../../data/travelclaw.db');
if (!existsSync(path))
  throw new Error('Database not found. Set DATABASE_PATH to the gateway database.');
const db = new DatabaseSync(path);
const how = (row) =>
  row.note_origin === 'page_claimed'
    ? 'CLAIMED BY THE PAGE — matched page text, verify before approving'
    : 'observed structurally by the worker';
try {
  if (command === 'list') {
    const rows = db
      .prepare(
        `SELECT * FROM browser_site_notes
         ORDER BY review_status = 'pending' DESC, runs DESC, last_seen_at DESC LIMIT 100`,
      )
      .all();
    console.log(
      JSON.stringify(
        rows.map((row) => ({
          id: row.id,
          status: row.review_status,
          note: browserSiteNoteSchema.parse({
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
          }),
          evidence: how(row),
        })),
        null,
        2,
      ),
    );
  } else {
    const row = db.prepare('SELECT * FROM browser_site_notes WHERE id = ?').get(id || '');
    if (!row) throw new Error('No site note with that id.');
    console.log(`Reviewing: ${row.site_id} ${row.origin} ${row.kind} — ${how(row)}`);
    db.prepare(
      'UPDATE browser_site_notes SET review_status = ?, reviewed_at = ? WHERE id = ?',
    ).run(command === 'approve' ? 'approved' : 'rejected', new Date().toISOString(), id);
    console.log(
      command === 'approve'
        ? 'Approved. This blocker is now supplied as a bounded hint on later runs.'
        : 'Rejected. It stays recorded but is never supplied to the desk.',
    );
  }
} finally {
  db.close();
}
