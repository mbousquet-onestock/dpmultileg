import { config } from './config.js';
import { getCredential } from './credentials.js';
import { mockOnestock } from './mock.js';

export class OnestockError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message?: string,
  ) {
    super(message ?? `OneStock API error ${status}`);
  }
}

interface Target {
  site_id: string;
  environment: string;
  api_url: string;
}

const tokens = new Map<string, Promise<string>>();
const cacheKey = (t: Target) => `${t.site_id}|${t.environment}|${t.api_url}`;

async function rawCall(apiUrl: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  let httpMethod: string = method;
  if (method === 'GET') {
    // fetch() can't send a body with GET: OneStock supports POST + method override.
    httpMethod = 'POST';
    headers['X-HTTP-Method-Override'] = 'GET';
  }
  const res = await fetch(`${apiUrl}${path}`, {
    method: httpMethod,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!res.ok) throw new OnestockError(res.status, json);
  return json;
}

async function login(t: Target): Promise<string> {
  const cred = await getCredential(t.site_id, t.environment);
  if (!cred) throw new OnestockError(412, { error: 'missing_credentials' }, `No credentials stored for ${t.site_id}/${t.environment}`);
  const res = (await rawCall(t.api_url, 'POST', '/login', { site_id: t.site_id, user_id: cred.user_id, password: cred.password })) as {
    token?: string;
  };
  if (!res?.token) throw new OnestockError(502, res, 'OneStock /login returned no token');
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

export function clearCaches(): void {
  tokens.clear();
  refCache.clear();
}
