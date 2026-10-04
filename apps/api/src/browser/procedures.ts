import { createHash } from 'node:crypto';
import { browserProcedureSchema, type BrowserProcedure } from '@travelclaw/shared';
import type { DatabaseService } from '../db/database.service';

/** Only finite workflow structure survives; values, labels, text and traces cannot. */
export function proposeProcedure(db: DatabaseService, input: BrowserProcedure) {
  const template = browserProcedureSchema.parse(input);
  const json = JSON.stringify(template);
  const id = createHash('sha256').update(json).digest('hex').slice(0, 24);
  db.run(
    'INSERT OR IGNORE INTO browser_procedures (id, site_id, origin, template_json, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    template.siteId,
    template.origin,
    json,
    'pending',
    new Date().toISOString(),
  );
}
export function reviewedSteps(
  db: DatabaseService,
  siteId: string,
  origin: string,
): BrowserProcedure['steps'] | undefined {
  const row = db.get<{ template_json: string }>(
    "SELECT template_json FROM browser_procedures WHERE site_id = ? AND origin = ? AND review_status = 'approved' ORDER BY reviewed_at DESC, id DESC LIMIT 1",
    siteId,
    origin,
  );
  if (!row) return undefined;
  const parsed = browserProcedureSchema.safeParse(JSON.parse(row.template_json));
  return parsed.success ? parsed.data.steps : undefined;
}
