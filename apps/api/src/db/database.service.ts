import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../config';
import { SCHEMA } from './schema';

type SqlValue = string | number | null | bigint | Uint8Array;

/**
 * Node's built-in SQLite avoids a native addon. It is still flagged experimental
 * upstream, so the start script silences that one warning.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db!: DatabaseSync;

  onModuleInit() {
    const { databasePath } = loadConfig();
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  onModuleDestroy() {
    this.db?.close();
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
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
