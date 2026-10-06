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

  it('drops stored market columns from a pre-existing users table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-migrate-market-'));
    const dbPath = join(dir, 'legacy.db');

    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        display_name TEXT NOT NULL,
        google_id TEXT UNIQUE,
        is_guest INTEGER NOT NULL DEFAULT 0,
        booker_country TEXT,
        market_currency TEXT,
        market_language TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users VALUES ('u1', 'ada@example.com', NULL, 'Ada', NULL, 0, 'NG', 'NGN', 'en-NG', '2025-01-01', '2025-01-01');
    `);
    legacy.close();

    const previous = { DATABASE_PATH: process.env.DATABASE_PATH };
    process.env.DATABASE_PATH = dbPath;
    try {
      const service = new DatabaseService();
      service.onModuleInit();
      try {
        const columns = service
          .all<{ name: string }>('PRAGMA table_info(users)')
          .map((c) => c.name);
        expect(columns).not.toContain('booker_country');
        expect(columns).not.toContain('market_currency');
        expect(columns).not.toContain('market_language');
        const user = service.get<{ email: string }>(
          'SELECT * FROM users WHERE id = ?',
          'u1',
        );
        expect(user?.email).toBe('ada@example.com');
      } finally {
        service.onModuleDestroy();
      }
    } finally {
      if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    }
  });

  it('adds is_guest to a pre-existing users table without touching real accounts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-migrate-guest-'));
    const dbPath = join(dir, 'legacy.db');

    // Simulate an install from before guest accounts existed: a users table with no
    // is_guest column at all.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        display_name TEXT NOT NULL,
        google_id TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy.exec(
      `INSERT INTO users VALUES ('u1', 'ada@example.com', 'scrypt$1$aa$bb', 'Ada', NULL, '2025-01-01', '2025-01-01')`,
    );
    legacy.close();

    const previous = { DATABASE_PATH: process.env.DATABASE_PATH };
    process.env.DATABASE_PATH = dbPath;
    try {
      const service = new DatabaseService();
      service.onModuleInit();
      try {
        const columns = service
          .all<{ name: string }>('PRAGMA table_info(users)')
          .map((c) => c.name);
        expect(columns).toContain('is_guest');
        const user = service.get<{ id: string; is_guest: number; email: string }>(
          'SELECT * FROM users WHERE id = ?',
          'u1',
        );
        expect(user?.email).toBe('ada@example.com');
        expect(user?.is_guest).toBe(0);
      } finally {
        service.onModuleDestroy();
      }
    } finally {
      if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    }
  });

  it('backfills provider_id on offers saved before provider fan-out was added', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-migrate-offers-'));
    const dbPath = join(dir, 'legacy.db');
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE offers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_base_url TEXT NOT NULL,
        provider_offer_id TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        currency TEXT NOT NULL,
        total_amount REAL NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        hold TEXT NOT NULL DEFAULT 'none',
        hold_ref TEXT,
        hold_expires_at TEXT,
        hold_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO offers VALUES (
        'o1', 's1', 't1', 'flight', 'Global Fares', 'https://fares.example.test',
        'F-1', '2026-10-02T09:30:00Z', 'USD', 180, 'LOS to LIS', NULL,
        'none', NULL, NULL, NULL, '2026-10-02T09:30:00Z', '2026-10-02T09:30:00Z'
      );
    `);
    legacy.close();

    const previous = { DATABASE_PATH: process.env.DATABASE_PATH };
    process.env.DATABASE_PATH = dbPath;
    try {
      const service = new DatabaseService();
      service.onModuleInit();
      try {
        const offer = service.get<{ provider_id: string; provider_base_url: string }>(
          'SELECT provider_id, provider_base_url FROM offers WHERE id = ?',
          'o1',
        );
        expect(offer?.provider_id).toBe('https://fares.example.test');
        expect(offer?.provider_id).toBe(offer?.provider_base_url);
      } finally {
        service.onModuleDestroy();
      }
    } finally {
      if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    }
  });

  it('adds attachments_json to a pre-attachments messages table, empty by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-migrate-attach-'));
    const dbPath = join(dir, 'legacy.db');

    // An install from before attachments: messages with tools but no attachments.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        display_name TEXT NOT NULL,
        google_id TEXT UNIQUE,
        is_guest INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tools_json TEXT NOT NULL DEFAULT '[]',
        provider TEXT,
        model TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      INSERT INTO users VALUES ('u1', 'ada@example.com', NULL, 'Ada', NULL, 0, '2025-01-01', '2025-01-01');
      INSERT INTO sessions VALUES ('s1', 'key-1', 'u1', 'marlow', 'webchat', 'operator', 'Old chat', '2025-01-01', '2025-01-01');
      INSERT INTO messages VALUES ('m1', 's1', 'user', 'hello', '[]', NULL, NULL, '2025-01-01');
    `);
    legacy.close();

    const previous = { DATABASE_PATH: process.env.DATABASE_PATH };
    process.env.DATABASE_PATH = dbPath;
    try {
      const service = new DatabaseService();
      service.onModuleInit();
      try {
        const columns = service
          .all<{ name: string }>('PRAGMA table_info(messages)')
          .map((c) => c.name);
        expect(columns).toContain('attachments_json');
        const message = service.get<{ content: string; attachments_json: string }>(
          'SELECT * FROM messages WHERE id = ?',
          'm1',
        );
        expect(message?.content).toBe('hello');
        expect(message?.attachments_json).toBe('[]');
      } finally {
        service.onModuleDestroy();
      }
    } finally {
      if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    }
  });

  it('adds hold_support to offers written before vendor adapters existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'travelclaw-migrate-hold-support-'));
    const dbPath = join(dir, 'legacy.db');

    // Simulate offers from a build whose only providers implemented the hold
    // contract: rows exist without a hold_support column.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE offers (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_base_url TEXT NOT NULL,
        provider_offer_id TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        currency TEXT NOT NULL,
        total_amount REAL NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        hold TEXT NOT NULL DEFAULT 'none',
        hold_ref TEXT,
        hold_expires_at TEXT,
        hold_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO offers VALUES ('o1', 's1', 't1', 'flight', 'Old Source', 'https://old.example.test', 'OFF-1', '2026-01-01T00:00:00Z', 'EUR', 100, 'Old offer', NULL, 'none', NULL, NULL, NULL, '2026-01-01', '2026-01-01');
    `);
    legacy.close();

    const previous = { DATABASE_PATH: process.env.DATABASE_PATH };
    process.env.DATABASE_PATH = dbPath;
    try {
      const service = new DatabaseService();
      service.onModuleInit();
      try {
        const columns = service
          .all<{ name: string }>('PRAGMA table_info(offers)')
          .map((c) => c.name);
        expect(columns).toContain('hold_support');
        expect(columns).toContain('facts_json');
        const offer = service.get<{
          hold_support: string;
          facts_json: string | null;
          title: string;
        }>('SELECT * FROM offers WHERE id = ?', 'o1');
        expect(offer?.title).toBe('Old offer');
        expect(offer?.hold_support).toBe('provider');
        // An older row keeps no facts: the card shows its prose, never a guess.
        expect(offer?.facts_json).toBeNull();
      } finally {
        service.onModuleDestroy();
      }
    } finally {
      if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    }
  });
});
