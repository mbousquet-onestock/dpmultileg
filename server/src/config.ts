import { randomBytes } from 'node:crypto';

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

/** Required environment variables missing in production (reported by /api/health and every API error). */
export const missingEnv: string[] = [];

function secret(name: string): string {
  const v = process.env[name];
  if (v) return v;
  // Don't crash at import time (the platform would answer an opaque HTML error): record the problem,
  // the API then answers a JSON 503 "server_misconfigured" listing what is missing.
  if (isProd) missingEnv.push(name);
  else console.warn(`[config] ${name} not set, using an ephemeral development value`);
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
  onVercel: !!process.env.VERCEL,
};

/** Configuration problems preventing the API from working. */
export function configProblems(): string[] {
  const problems = missingEnv.map((n) => `missing environment variable ${n}`);
  if (config.onVercel && !config.databaseUrl) problems.push('missing DATABASE_URL (Vercel has no persistent disk: add Neon Postgres from the Marketplace)');
  return problems;
}
