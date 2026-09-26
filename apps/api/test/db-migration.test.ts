import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from '../src/db/database.service';

describe('accounts migration', () => {
  it('drops pre-account sessions instead of booting with a broken NOT NULL column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-migrate-'));
    const dbPath = join(dir, 'legacy.db');

    // Simulate a pre-accounts install: sessions/messages with no user_id at all.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tools_json TEXT NOT NULL DEFAULT '[]',
        provider TEXT,
        model TEXT,
        created_at TEXT NOT NULL
      );
    `);
    legacy.exec(
      `INSERT INTO sessions VALUES ('s1', 'agent:marlow:webchat:operator', 'marlow', 'webchat', 'operator', 'Old chat', '2025-01-01', '2025-01-01')`,
    );
    legacy.exec(
      `INSERT INTO messages VALUES ('m1', 's1', 'user', 'hello', '[]', NULL, NULL, '2025-01-01')`,
    );
    legacy.close();

    const previous = { DATABASE_PATH: process.env.DATABASE_PATH };
    process.env.DATABASE_PATH = dbPath;
    try {
      const service = new DatabaseService();
      service.onModuleInit();
      try {
        const columns = service
          .all<{ name: string }>('PRAGMA table_info(sessions)')
          .map((c) => c.name);
        expect(columns).toContain('user_id');
        expect(service.all('SELECT * FROM sessions')).toHaveLength(0);
        expect(service.all('SELECT * FROM messages')).toHaveLength(0);
        expect(service.all('SELECT * FROM users')).toHaveLength(0);
      } finally {
        service.onModuleDestroy();
      }
    } finally {
      if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    }
  });
});
