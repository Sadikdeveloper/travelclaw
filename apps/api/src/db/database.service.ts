import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config';
import { ensureMemoryFts } from './memory-search-schema';
import { SCHEMA } from './schema';

type SqlValue = string | number | null | bigint | Uint8Array;

/**
 * Node's built-in SQLite avoids a native addon. It is still flagged experimental
 * upstream, so the start script silences that one warning.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db!: DatabaseSync;
  private memoryFts = false;

  onModuleInit() {
    const { databasePath } = loadConfig();
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrateLegacyNames();
    this.migrateToAccounts();
    this.migrateToGuests();
    this.migrateAwayFromStoredMarket();
    this.migrateToAttachments();
    this.db.exec(SCHEMA);
    this.migrateOfferProviderIds();
    this.migrateOfferHoldSupport();
    this.migrateOfferFacts();
    this.ensureMemorySearch();
  }

  /**
   * The memory search index is derived from `memory_notes`, so every boot
   * reconciles it instead of trusting it. It is created after `SCHEMA` because it
   * shadows a table `SCHEMA` owns, and a SQLite without FTS5 leaves search on its
   * `LIKE` scan rather than failing the start.
   */
  private ensureMemorySearch() {
    const status = ensureMemoryFts(this);
    this.memoryFts = status.available;
    if (!status.available) {
      this.logger.warn(`Memory search has no FTS5 index: ${status.reason}`);
    } else if (status.rebuilt) {
      this.logger.log('Rebuilt the memory search index from memory_notes.');
    }
  }

  /** False when this SQLite has no usable FTS5 index; search scans instead. */
  hasMemoryFts(): boolean {
    return this.memoryFts;
  }

  /** Old installs used a skill catalog. Rename before CREATE so history is kept. */
  private migrateLegacyNames() {
    const tables = new Set(
      this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
    );
    if (tables.has('messages')) {
      const columns = this.all<{ name: string }>('PRAGMA table_info(messages)');
      const names = new Set(columns.map((column) => column.name));
      if (names.has('skills_json') && !names.has('tools_json')) {
        this.db.exec('ALTER TABLE messages RENAME COLUMN skills_json TO tools_json');
      }
    }
    let runTable: string | null = null;
    if (tables.has('skill_runs') && !tables.has('tool_runs')) {
      this.db.exec('ALTER TABLE skill_runs RENAME TO tool_runs');
      runTable = 'tool_runs';
    } else if (tables.has('tool_runs')) {
      runTable = 'tool_runs';
    }
    if (runTable) {
      const columns = this.all<{ name: string }>(`PRAGMA table_info(${runTable})`);
      const names = new Set(columns.map((column) => column.name));
      if (names.has('skill') && !names.has('tool')) {
        this.db.exec(`ALTER TABLE ${runTable} RENAME COLUMN skill TO tool`);
      }
    }
  }

  /**
   * Sessions now belong to an account (`user_id`, NOT NULL). Pre-account installs have
   * no owner to assign, so those chats and their child rows are dropped on upgrade —
   * there is no migration framework yet, per docs/architecture.md. Trips and memory are
   * desk-wide and are left alone.
   */
  private migrateToAccounts() {
    const tables = new Set(
      this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
    );
    if (!tables.has('sessions')) return;
    const columns = this.all<{ name: string }>('PRAGMA table_info(sessions)');
    if (columns.some((column) => column.name === 'user_id')) return;
    this.db.exec('DROP TABLE IF EXISTS agent_tasks');
    this.db.exec('DROP TABLE IF EXISTS messages');
    this.db.exec('DROP TABLE IF EXISTS sessions');
  }

  /**
   * Guest (no-signup) accounts need a flag to tell them apart from real ones. Real
   * accounts on an existing install predate this column, so it is added in place —
   * everyone already there defaults to `is_guest = 0`, which is correct for them.
   */
  private migrateToGuests() {
    const tables = new Set(
      this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
    );
    if (!tables.has('users')) return;
    const columns = this.all<{ name: string }>('PRAGMA table_info(users)');
    if (columns.some((column) => column.name === 'is_guest')) return;
    this.db.exec('ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0');
  }

  /**
   * Search market is read from the message that states it (see `searchMarketFrom`),
   * so the per-account point-of-sale columns are dropped rather than left to rot as
   * a profile nobody updates. `DROP COLUMN` needs SQLite 3.35+; an install too old
   * for it keeps three unused columns and logs it instead of failing to start.
   */
  private migrateAwayFromStoredMarket() {
    const tables = new Set(
      this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
    );
    if (!tables.has('users')) return;
    const names = new Set(
      this.all<{ name: string }>('PRAGMA table_info(users)').map((column) => column.name),
    );
    for (const column of ['booker_country', 'market_currency', 'market_language']) {
      if (!names.has(column)) continue;
      try {
        this.db.exec(`ALTER TABLE users DROP COLUMN ${column}`);
      } catch {
        this.logger.warn(
          `Left unused users.${column} in place: this SQLite cannot drop it.`,
        );
      }
    }
  }

  /**
   * Messages gained an `attachments_json` column: names, kinds, sizes, and image
   * thumbnails ride with the row — the files themselves never reach the gateway.
   * Existing installs get the column in place, defaulting to "no attachments".
   */
  private migrateToAttachments() {
    const tables = this.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    if (!tables.some((table) => table.name === 'messages')) return;
    const columns = this.all<{ name: string }>('PRAGMA table_info(messages)');
    if (columns.some((column) => column.name === 'attachments_json')) return;
    this.db.exec(
      "ALTER TABLE messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'",
    );
  }

  /** Offers need a stable connector id once one search can fan out to many providers. */
  private migrateOfferProviderIds() {
    const tables = new Set(
      this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
    );
    if (!tables.has('offers')) return;
    const columns = this.all<{ name: string }>('PRAGMA table_info(offers)');
    if (columns.some((column) => column.name === 'provider_id')) return;
    this.db.exec("ALTER TABLE offers ADD COLUMN provider_id TEXT NOT NULL DEFAULT ''");
    // Older rows used the endpoint itself as their hold-routing identity.
    this.db.exec(
      "UPDATE offers SET provider_id = provider_base_url WHERE provider_id = ''",
    );
  }

  /**
   * Offers written before vendor adapters existed came from a source that
   * implements the hold contract, so they keep the `provider` default. A vendor
   * that only quotes prices records `unsupported` instead.
   */
  private migrateOfferHoldSupport() {
    const tables = new Set(
      this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
    );
    if (!tables.has('offers')) return;
    const columns = this.all<{ name: string }>('PRAGMA table_info(offers)');
    if (columns.some((column) => column.name === 'hold_support')) return;
    this.db.exec(
      "ALTER TABLE offers ADD COLUMN hold_support TEXT NOT NULL DEFAULT 'provider'",
    );
  }

  /**
   * Structured offer facts arrived with the row layout. Offers written before
   * them keep `NULL` and the card falls back to their prose, so no old row has to
   * be back-filled with a guess.
   */
  private migrateOfferFacts() {
    const tables = new Set(
      this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
    );
    if (!tables.has('offers')) return;
    const columns = this.all<{ name: string }>('PRAGMA table_info(offers)');
    if (columns.some((column) => column.name === 'facts_json')) return;
    this.db.exec('ALTER TABLE offers ADD COLUMN facts_json TEXT');
  }

  onModuleDestroy() {
    this.db?.close();
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** Statements with no parameters and no result, such as DDL. */
  exec(sql: string) {
    this.db.exec(sql);
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SqlValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
