import { config } from './config.js';
import { decrypt, encrypt } from './crypto.js';
import { getStore, type CredentialRow } from './db.js';

export interface CredentialInput {
  site_id: string;
  environment: string;
  user_id: string;
  password: string;
  /** Base URL of the OneStock API for this site/environment (optional, see resolveApiUrl). */
  api_url?: string | null;
  /** UI extension secret hashes (latest first) used to verify the extension signature. */
  extension_secrets?: string[] | null;
  label?: string | null;
}

export interface Credential {
  site_id: string;
  environment: string;
  api_url: string | null;
  user_id: string;
  password: string;
  extension_secrets: string[];
  label: string | null;
}

/** Public view: never exposes secrets. */
export interface CredentialSummary {
  site_id: string;
  environment: string;
  api_url: string | null;
  user_id: string;
  has_extension_secrets: boolean;
  label: string | null;
  updated_at: string;
}

type Row = CredentialRow;

const ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function validateInput(input: Partial<CredentialInput>): string | null {
  if (!input.site_id || !ID.test(input.site_id)) return 'site_id is required (letters, digits, _ . -)';
  if (!input.environment || !ID.test(input.environment)) return 'environment is required (letters, digits, _ . -)';
  if (!input.user_id) return 'user_id is required';
  if (!input.password) return 'password is required';
  if (input.api_url && !isAllowedApiUrl(input.api_url)) return `api_url must be an https URL whose host matches ${config.allowedApiHost}`;
  if (input.extension_secrets && (!Array.isArray(input.extension_secrets) || input.extension_secrets.some((s) => typeof s !== 'string' || !s)))
    return 'extension_secrets must be an array of non empty strings';
  return null;
}

export function isAllowedApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && config.allowedApiHost.test(u.hostname);
  } catch {
    return false;
  }
}

export async function upsertCredential(input: CredentialInput): Promise<void> {
  const err = validateInput(input);
  if (err) throw new Error(err);
  await (await getStore()).upsert({
    site_id: input.site_id,
    environment: input.environment,
    api_url: input.api_url ? input.api_url.replace(/\/+$/, '') : null,
    user_id: input.user_id,
    password_enc: encrypt(input.password),
    extension_secrets_enc: input.extension_secrets?.length ? encrypt(JSON.stringify(input.extension_secrets)) : null,
    label: input.label ?? null,
  });
}

function fromRow(row: Row): Credential {
  return {
    site_id: row.site_id,
    environment: row.environment,
    api_url: row.api_url,
    user_id: row.user_id,
    password: decrypt(row.password_enc),
    extension_secrets: row.extension_secrets_enc ? (JSON.parse(decrypt(row.extension_secrets_enc)) as string[]) : [],
    label: row.label,
  };
}

export async function getCredential(siteId: string, environment: string): Promise<Credential | undefined> {
  const row = await (await getStore()).get(siteId, environment);
  return row ? fromRow(row) : undefined;
}

export async function listCredentials(siteId?: string): Promise<CredentialSummary[]> {
  const rows: Row[] = await (await getStore()).list(siteId);
  return rows.map((r) => ({
    site_id: r.site_id,
    environment: r.environment,
    api_url: r.api_url,
    user_id: r.user_id,
    has_extension_secrets: !!r.extension_secrets_enc,
    label: r.label,
    updated_at: r.updated_at,
  }));
}

export async function deleteCredential(siteId: string, environment: string): Promise<boolean> {
  return (await getStore()).delete(siteId, environment);
}

/**
 * Guess the OneStock environment from the API URL received in the extension handshake.
 * ex: https://c00.api.qualif.onestock-retail.com -> qualif
 *     https://api-client.eu1.prod.onestock-retail.com -> prod
 */
export function environmentFromApiUrl(apiUrl: string): string | undefined {
  try {
    const labels = new URL(apiUrl).hostname.split('.');
    const known = ['qualif', 'training', 'preprod', 'staging', 'sandbox', 'demo', 'dev', 'prod'];
    return labels.find((l) => known.includes(l));
  } catch {
    return undefined;
  }
}

/**
 * Find the credentials matching the calling OneStock instance:
 * 1. the row of this site whose api_url has the same origin as the handshake api_url
 * 2. otherwise the row of the environment deduced from the api_url host
 * 3. otherwise an explicitly requested environment (standalone / dev mode)
 */
export async function resolveCredential(siteId: string, apiUrl?: string, environment?: string): Promise<Credential | undefined> {
  if (apiUrl) {
    let origin: string | undefined;
    try {
      origin = new URL(apiUrl).origin;
    } catch {
      /* ignore */
    }
    if (origin) {
      for (const summary of await listCredentials(siteId)) {
        if (summary.api_url && new URL(summary.api_url).origin === origin) return getCredential(siteId, summary.environment);
      }
    }
    const env = environmentFromApiUrl(apiUrl);
    if (env) {
      const c = await getCredential(siteId, env);
      if (c) return c;
    }
  }
  if (environment) return getCredential(siteId, environment);
  return undefined;
}

/**
 * Credentials are only ever sent to the API URL stored in DB, or - when none is stored -
 * to the handshake api_url provided it is a OneStock host.
 */
export function resolveApiUrl(cred: Credential, handshakeApiUrl?: string): string | undefined {
  if (cred.api_url) return cred.api_url;
  if (handshakeApiUrl && isAllowedApiUrl(handshakeApiUrl)) return new URL(handshakeApiUrl).origin;
  if (cred.environment !== 'prod') return `https://${cred.site_id}.api.${cred.environment}.onestock-retail.com`;
  return undefined;
}
