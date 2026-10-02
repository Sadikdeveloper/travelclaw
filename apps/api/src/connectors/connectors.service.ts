import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ToolConnectors } from '@travelclaw/agent-core';
import type {
  ConnectorName,
  ConnectorRecord,
  ConnectorStatus,
  UpsertConnectorInput,
} from '@travelclaw/shared';
import { newId, nowIso } from '../common/util';
import { loadConfig } from '../config';
import { DatabaseService } from '../db/database.service';

interface ConnectorRow {
  id: string;
  user_id: string;
  name: string;
  base_url: string | null;
  api_key: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * The only connectors the desk knows. A connector is a key the traveler
 * provides, not a new language: it cannot add a tool, a prompt line, or any
 * code — built-in tools resolve one of these names when they call out.
 */
const SUPPORTED: Array<{ name: ConnectorName; label: string; detail: string }> = [
  {
    name: 'currency',
    label: 'Rates',
    detail:
      'Frankfurter-compatible exchange rates. Without one the desk uses its own table.',
  },
  {
    name: 'weather',
    label: 'Forecast',
    detail: 'Open-Meteo-compatible forecast. Without one the desk uses its seasonal card.',
  },
];

function isSupported(name: string): name is ConnectorName {
  return SUPPORTED.some((entry) => entry.name === name);
}

/**
 * The last four characters of a traveler's own key, so they can tell keys
 * apart. A key too short to hint at is reported as set but unreadable — its
 * suffix would be the secret itself.
 */
function keySuffix(key: string | null): string | null {
  if (!key) return null;
  return key.length > 4 ? key.slice(-4) : '••••';
}

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Every supported connector with this traveler's status on it. No secrets. */
  list(userId: string): ConnectorRecord[] {
    const config = loadConfig();
    return SUPPORTED.map((entry) => {
      const row = this.row(userId, entry.name);
      if (row) return this.record(entry, row);
      const env = this.envFor(entry.name, config);
      if (env.baseUrl || env.apiKey) {
        return {
          name: entry.name,
          label: entry.label,
          detail: entry.detail,
          status: 'configured' as ConnectorStatus,
          source: 'environment' as const,
          baseUrl: env.baseUrl,
          // The operator's key is not this traveler's to inspect, not even its suffix.
          keySuffix: null,
          updatedAt: null,
        };
      }
      return {
        name: entry.name,
        label: entry.label,
        detail: entry.detail,
        status: 'missing' as ConnectorStatus,
        source: null,
        baseUrl: null,
        keySuffix: null,
        updatedAt: null,
      };
    });
  }

  /** What a tool sends: the traveler's row first, the operator's env fallback. */
  credentialsFor(
    userId: string,
    name: string,
  ): { baseUrl?: string; apiKey?: string } | undefined {
    if (!isSupported(name)) return undefined;
    const row = this.row(userId, name);
    // A stored row replaces the env fallback outright, so a traveler can always
    // see and clear exactly what the desk will use for them.
    if (row) {
      const credentials: { baseUrl?: string; apiKey?: string } = {};
      if (row.base_url) credentials.baseUrl = row.base_url;
      if (row.api_key) credentials.apiKey = row.api_key;
      return credentials.baseUrl || credentials.apiKey ? credentials : undefined;
    }
    const env = this.envFor(name, loadConfig());
    if (!env.baseUrl && !env.apiKey) return undefined;
    return {
      ...(env.baseUrl ? { baseUrl: env.baseUrl } : {}),
      ...(env.apiKey ? { apiKey: env.apiKey } : {}),
    };
  }

  /** The resolver a turn runs with. Tools read credentials; they never see whose. */
  resolverFor(userId: string): ToolConnectors {
    return {
      get: (name: string) => this.credentialsFor(userId, name),
      rejected: (name: string) => this.markRejected(userId, name),
    };
  }

  /**
   * Store a key and/or base URL. An omitted field keeps its value, an empty one
   * clears it. Saving clears a `rejected` flag — the traveler just fixed it.
   * Nothing here logs or returns the secret.
   */
  upsert(userId: string, name: string, input: UpsertConnectorInput): ConnectorRecord {
    const entry = SUPPORTED.find((item) => item.name === name);
    if (!entry) throw new NotFoundException(`No connector ${name}`);
    const existing = this.row(userId, entry.name);
    const baseUrl =
      input.baseUrl === undefined
        ? (existing?.base_url ?? null)
        : input.baseUrl.trim() === ''
          ? null
          : input.baseUrl.trim().replace(/\/+$/, '');
    const apiKey =
      input.apiKey === undefined
        ? (existing?.api_key ?? null)
        : input.apiKey.trim() === ''
          ? null
          : input.apiKey.trim();
    if (!baseUrl && !apiKey) {
      throw new BadRequestException({
        code: 'connector_empty',
        message: 'Set a base URL or a key — clearing both is what Remove is for.',
      });
    }
    const now = nowIso();
    if (existing) {
      this.db.run(
        `UPDATE connectors SET base_url = ?, api_key = ?, status = 'configured', updated_at = ?
         WHERE user_id = ? AND name = ?`,
        baseUrl,
        apiKey,
        now,
        userId,
        entry.name,
      );
    } else {
      this.db.run(
        `INSERT INTO connectors (id, user_id, name, base_url, api_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'configured', ?, ?)`,
        newId(),
        userId,
        entry.name,
        baseUrl,
        apiKey,
        now,
        now,
      );
    }
    this.logger.log(`Connector ${entry.name} saved`);
    return this.record(entry, this.row(userId, entry.name)!);
  }

  /** Forget a traveler's row. An operator env fallback, if any, applies again. */
  remove(userId: string, name: string): ConnectorRecord {
    const entry = SUPPORTED.find((item) => item.name === name);
    if (!entry) throw new NotFoundException(`No connector ${name}`);
    this.db.run('DELETE FROM connectors WHERE user_id = ? AND name = ?', userId, name);
    this.logger.log(`Connector ${entry.name} removed`);
    return this.list(userId).find((item) => item.name === entry.name)!;
  }

  /**
   * A provider answered 401/403, so the stored credentials no longer work. Only
   * a traveler's own row is marked — an env fallback has nowhere to persist a
   * rejection, so that one just falls back for the turn.
   */
  markRejected(userId: string, name: string): void {
    if (!isSupported(name)) return;
    const row = this.row(userId, name);
    if (!row || row.status === 'rejected') return;
    this.db.run(
      `UPDATE connectors SET status = 'rejected', updated_at = ? WHERE user_id = ? AND name = ?`,
      nowIso(),
      userId,
      name,
    );
    this.logger.warn(`Connector ${name} was rejected by its provider`);
  }

  private row(userId: string, name: string): ConnectorRow | undefined {
    return this.db.get<ConnectorRow>(
      'SELECT * FROM connectors WHERE user_id = ? AND name = ?',
      userId,
      name,
    );
  }

  private record(
    entry: { name: ConnectorName; label: string; detail: string },
    row: ConnectorRow,
  ): ConnectorRecord {
    return {
      name: entry.name,
      label: entry.label,
      detail: entry.detail,
      status: (row.status === 'rejected' ? 'rejected' : 'configured') as ConnectorStatus,
      source: 'account',
      baseUrl: row.base_url,
      keySuffix: keySuffix(row.api_key),
      updatedAt: row.updated_at,
    };
  }

  private envFor(
    name: ConnectorName,
    config: ReturnType<typeof loadConfig>,
  ): { baseUrl: string | null; apiKey: string | null } {
    return name === 'currency'
      ? { baseUrl: config.currencyBaseUrl, apiKey: config.currencyApiKey }
      : { baseUrl: config.weatherBaseUrl, apiKey: config.weatherApiKey };
  }
}
