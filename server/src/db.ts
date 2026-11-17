/**
 * Storage for the OneStock credentials.
 *  - DATABASE_URL / POSTGRES_URL set (Vercel + Neon Postgres): Postgres over HTTP (serverless friendly)
 *  - otherwise: local SQLite file (node:sqlite), for development / self hosting.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

export interface CredentialRow {
  site_id: string;
  environment: string;
  api_url: string | null;
  user_id: string;
  password_enc: string;
  extension_secrets_enc: string | null;
  label: string | null;
  updated_at: string;
}

export interface Store {
  kind: 'sqlite' | 'postgres';
  upsert(row: Omit<CredentialRow, 'updated_at'>): Promise<void>;
  get(siteId: string, environment: string): Promise<CredentialRow | undefined>;
  list(siteId?: string): Promise<CredentialRow[]>;
  delete(siteId: string, environment: string): Promise<boolean>;
}

const COLUMNS = ['site_id', 'environment', 'api_url', 'user_id', 'password_enc', 'extension_secrets_enc', 'label'] as const;

/* ------------------------------------------------------------------------------------------ SQLite */

async function sqliteStore(path: string): Promise<Store> {
  const { DatabaseSync } = await import('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      site_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      api_url TEXT,
      user_id TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      extension_secrets_enc TEXT,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (site_id, environment)
    );`);
  return {
    kind: 'sqlite',
    async upsert(r) {
      db.prepare(
        `INSERT INTO credentials (${COLUMNS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (site_id, environment) DO UPDATE SET
           api_url = excluded.api_url, user_id = excluded.user_id, password_enc = excluded.password_enc,
           extension_secrets_enc = COALESCE(excluded.extension_secrets_enc, credentials.extension_secrets_enc),
           label = excluded.label, updated_at = datetime('now')`,
      ).run(...COLUMNS.map((c) => r[c]));
    },
    async get(siteId, env) {
      return db.prepare('SELECT * FROM credentials WHERE site_id = ? AND environment = ?').get(siteId, env) as CredentialRow | undefined;
    },
    async list(siteId) {
      const rows = siteId
        ? db.prepare('SELECT * FROM credentials WHERE site_id = ? ORDER BY site_id, environment').all(siteId)
        : db.prepare('SELECT * FROM credentials ORDER BY site_id, environment').all();
      return rows as unknown as CredentialRow[];
    },
    async delete(siteId, env) {
      return Number(db.prepare('DELETE FROM credentials WHERE site_id = ? AND environment = ?').run(siteId, env).changes) > 0;
    },
  };
}

/* ---------------------------------------------------------------------------------------- Postgres */

async function postgresStore(url: string): Promise<Store> {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS dpm_credentials (
      site_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      api_url TEXT,
      user_id TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      extension_secrets_enc TEXT,
      label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, environment)
    )`);
  const rows = (r: unknown) => (r as Record<string, unknown>[]).map((x) => ({ ...x, updated_at: String(x.updated_at) }) as CredentialRow);
  return {
    kind: 'postgres',
    async upsert(r) {
      await sql.query(
        `INSERT INTO dpm_credentials (${COLUMNS.join(', ')}) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (site_id, environment) DO UPDATE SET
           api_url = EXCLUDED.api_url, user_id = EXCLUDED.user_id, password_enc = EXCLUDED.password_enc,
           extension_secrets_enc = COALESCE(EXCLUDED.extension_secrets_enc, dpm_credentials.extension_secrets_enc),
           label = EXCLUDED.label, updated_at = now()`,
        COLUMNS.map((c) => r[c]),
      );
    },
    async get(siteId, env) {
      return rows(await sql.query('SELECT * FROM dpm_credentials WHERE site_id = $1 AND environment = $2', [siteId, env]))[0];
    },
    async list(siteId) {
      return rows(
        siteId
          ? await sql.query('SELECT * FROM dpm_credentials WHERE site_id = $1 ORDER BY site_id, environment', [siteId])
          : await sql.query('SELECT * FROM dpm_credentials ORDER BY site_id, environment'),
      );
    },
    async delete(siteId, env) {
      const r = await sql.query('DELETE FROM dpm_credentials WHERE site_id = $1 AND environment = $2 RETURNING site_id', [siteId, env]);
      return (r as unknown[]).length > 0;
    },
  };
}

let store: Promise<Store> | undefined;

export function getStore(): Promise<Store> {
  if (!store) {
    store = config.databaseUrl ? postgresStore(config.databaseUrl) : sqliteStore(config.dbPath);
    store.catch(() => (store = undefined));
  }
  return store;
}

/** Test helper. */
export function resetStore(): void {
  store = undefined;
}
