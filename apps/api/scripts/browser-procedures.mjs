// Operator-only maintenance command. Deliberately NOT an HTTP or model tool.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { browserProcedureSchema } from '@travelclaw/shared';
const [command = 'list', id] = process.argv.slice(2);
if (!['list', 'approve', 'reject'].includes(command))
  throw new Error('Use list, approve <id>, or reject <id>.');
const path = resolve(process.env.DATABASE_PATH || '../../data/travelclaw.db');
if (!existsSync(path))
  throw new Error('Database not found. Set DATABASE_PATH to the gateway database.');
const db = new DatabaseSync(path);
try {
  if (command === 'list') {
    const rows = db
      .prepare('SELECT * FROM browser_procedures ORDER BY created_at DESC LIMIT 100')
      .all();
    console.log(
      JSON.stringify(
        rows.map((row) => ({
          id: row.id,
          status: row.review_status,
          procedure: browserProcedureSchema.parse(JSON.parse(row.template_json)),
        })),
        null,
        2,
      ),
    );
  } else {
    const row = db
      .prepare('SELECT template_json FROM browser_procedures WHERE id = ?')
      .get(id || '');
    if (!row) throw new Error('No procedure with that id.');
    browserProcedureSchema.parse(JSON.parse(row.template_json));
    db.prepare(
      'UPDATE browser_procedures SET review_status = ?, reviewed_at = ? WHERE id = ?',
    ).run(command === 'approve' ? 'approved' : 'rejected', new Date().toISOString(), id);
    console.log(
      'Procedure review saved. Only approved procedures are supplied as bounded hints.',
    );
  }
} finally {
  db.close();
}
