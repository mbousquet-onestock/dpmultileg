import { randomBytes } from 'node:crypto';

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

function secret(name: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`Missing required environment variable ${name}`);
  // Dev only: ephemeral secret, regenerated on every restart.
  console.warn(`[config] ${name} not set, using an ephemeral development value`);
  return randomBytes(32).toString('hex');
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Postgres connection string (Vercel / Neon). When empty, a local SQLite file is used. */
  databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '',
  dbPath: process.env.DB_PATH ?? 'data/dpmultileg.sqlite',
  /** 32 bytes key (hex or base64) used to encrypt passwords and extension secrets at rest. */
  credentialsKey: secret('CREDENTIALS_KEY'),
  /** Secret used to sign the short-lived session JWT handed to the iframe. */
  jwtSecret: secret('JWT_SECRET'),
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 3600),
  /** Bearer token protecting the /api/admin routes (credentials management). Disabled when empty. */
  adminToken: process.env.ADMIN_TOKEN ?? '',
  /** Accept sessions without a valid OneStock extension signature (local development only). */
  allowUnsigned: bool(process.env.ALLOW_UNSIGNED, !isProd),
  /** Serve fake OneStock data instead of calling the real API (demo / local development). */
  mockOnestock: bool(process.env.MOCK_ONESTOCK, false),
  /** Max age of an extension signature, as recommended by OneStock (6h). */
  signatureMaxAgeSeconds: Number(process.env.SIGNATURE_MAX_AGE_SECONDS ?? 6 * 3600),
  /** Cache duration for referential data (delivery configs, routes, zones). */
  referentialCacheSeconds: Number(process.env.REFERENTIAL_CACHE_SECONDS ?? 300),
  /** Hosts the backend is allowed to send OneStock credentials to. */
  allowedApiHost: new RegExp(process.env.ALLOWED_API_HOST ?? '^[a-z0-9.-]+\\.onestock-retail\\.(com|dev)$'),
  /** Origins allowed to embed the extension (CSP frame-ancestors). */
  frameAncestors: process.env.FRAME_ANCESTORS ?? "'self' https://*.onestock-retail.com https://*.onestock-retail.dev",
  isProd,
};
