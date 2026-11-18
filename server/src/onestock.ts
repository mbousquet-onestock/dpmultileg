import http from 'node:http';
import https from 'node:https';
import { config } from './config.js';
import { getCredential } from './credentials.js';
import { log } from './logger.js';
import { mockOnestock } from './mock.js';

export class OnestockError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message?: string,
    public path?: string,
    public requestId?: string,
  ) {
    super(message ?? describe(status, body, path));
  }
}

function describe(status: number, body: unknown, path?: string): string {
  const b = body as { message?: string; error?: string; errors?: unknown } | string | undefined;
  const detail = typeof b === 'string' ? b.slice(0, 200) : (b?.message ?? b?.error ?? (b?.errors ? JSON.stringify(b.errors).slice(0, 200) : ''));
  return `OneStock ${path ?? ''} answered ${status}${detail ? `: ${detail}` : ''}`;
}

interface Target {
  site_id: string;
  environment: string;
  api_url: string;
}

const tokens = new Map<string, Promise<string>>();
const cacheKey = (t: Target) => `${t.site_id}|${t.environment}|${t.api_url}`;

/**
 * HTTP call with node:http(s), which (unlike fetch) can send a body with a GET request.
 * OneStock GET routes take their parameters in a JSON body (like Postman does); the POST +
 * X-HTTP-Method-Override fallback is not accepted by every route (e.g. GET /timetables/{id}).
 */
function httpCall(url: string, method: string, body: string | undefined, timeoutMs = 30_000): Promise<{ status: number; requestId?: string; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      u,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, requestId: (res.headers['request-id'] as string | undefined) ?? undefined, text: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function rawCall(apiUrl: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown): Promise<unknown> {
  const started = Date.now();
  let res: { status: number; requestId?: string; text: string };
  try {
    res = await httpCall(`${apiUrl}${path}`, method, body === undefined ? undefined : JSON.stringify(body));
  } catch (e) {
    const cause = e instanceof Error ? ((e.cause as Error | undefined)?.message ?? e.message) : String(e);
    log('error', 'onestock_unreachable', { api_host: new URL(apiUrl).host, path, ms: Date.now() - started, error: cause });
    throw new OnestockError(502, { error: 'unreachable', cause }, `OneStock API unreachable (${new URL(apiUrl).host}${path}): ${cause}`, path);
  }
  const ok = res.status >= 200 && res.status < 300;
  log(ok ? 'debug' : 'warn', 'onestock_call', { api_host: new URL(apiUrl).host, method, path, status: res.status, ms: Date.now() - started, onestock_request_id: res.requestId });
  let json: unknown = undefined;
  try {
    json = res.text ? JSON.parse(res.text) : undefined;
  } catch {
    json = res.text;
  }
  if (!ok) throw new OnestockError(res.status, json, undefined, path, res.requestId);
  return json;
}

async function login(t: Target): Promise<string> {
  const cred = await getCredential(t.site_id, t.environment);
  if (!cred) throw new OnestockError(412, { error: 'missing_credentials' }, `No credentials stored for ${t.site_id}/${t.environment}`, '/login');
  log('info', 'onestock_login', { site_id: t.site_id, environment: t.environment, api_host: new URL(t.api_url).host, user_id: cred.user_id });
  const res = (await rawCall(t.api_url, 'POST', '/login', { site_id: t.site_id, user_id: cred.user_id, password: cred.password })) as {
    token?: string;
  };
  if (!res?.token) throw new OnestockError(502, res, 'OneStock /login returned no token', '/login');
  return res.token;
}

function getToken(t: Target, force = false): Promise<string> {
  const k = cacheKey(t);
  if (force) tokens.delete(k);
  let p = tokens.get(k);
  if (!p) {
    p = login(t);
    p.catch(() => tokens.delete(k));
    tokens.set(k, p);
  }
  return p;
}

/** Call the OneStock API with a token generated from the credentials stored for this site/environment. */
export async function callOnestock<T = unknown>(
  t: Target,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  if (config.mockOnestock) return mockOnestock(method, path, body) as T;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(t, attempt > 0);
    try {
      return (await rawCall(t.api_url, method, path, { ...body, site_id: t.site_id, token })) as T;
    } catch (e) {
      // Token expired / revoked: login again once.
      if (e instanceof OnestockError && e.status === 401 && attempt === 0) continue;
      throw e;
    }
  }
  throw new OnestockError(401, { error: 'unauthorized' });
}

/** Small TTL cache for referential data (configs, routes, zones) shared by all users of a site/env. */
const refCache = new Map<string, { at: number; value: Promise<unknown> }>();

export function cached<T>(t: Target, name: string, loader: () => Promise<T>): Promise<T> {
  const k = `${cacheKey(t)}|${name}`;
  const hit = refCache.get(k);
  if (hit && Date.now() - hit.at < config.referentialCacheSeconds * 1000) return hit.value as Promise<T>;
  const value = loader();
  value.catch(() => refCache.delete(k));
  refCache.set(k, { at: Date.now(), value });
  return value;
}

/** Forget tokens and cached referential of a site/environment (after its credentials changed). */
export function clearSiteCaches(siteId: string, environment: string): void {
  const prefix = `${siteId}|${environment}|`;
  for (const k of [...tokens.keys()]) if (k.startsWith(prefix)) tokens.delete(k);
  for (const k of [...refCache.keys()]) if (k.startsWith(prefix)) refCache.delete(k);
}

/** Try a POST /login with the given credentials (configuration screen). Never caches the token. */
export async function testLogin(apiUrl: string, siteId: string, userId: string, password: string): Promise<void> {
  const res = (await rawCall(apiUrl, 'POST', '/login', { site_id: siteId, user_id: userId, password })) as { token?: string };
  if (!res?.token) throw new OnestockError(502, res, 'OneStock /login returned no token', '/login');
}

export function clearCaches(): void {
  tokens.clear();
  refCache.clear();
}
