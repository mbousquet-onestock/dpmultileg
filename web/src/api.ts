import type { DeliveryConfig, DeliveryRoute, Endpoint, Item, PromiseOption, SalesChannel, Zone } from '@shared/types';

export interface Referential {
  delivery_configs: DeliveryConfig[];
  delivery_routes: DeliveryRoute[];
  zones: Zone[];
  sales_channels: SalesChannel[];
  endpoints: Endpoint[];
}

export interface SessionInfo {
  token: string;
  expires_at: number;
  site_id: string;
  environment: string;
  signed: boolean;
  mock: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
    /** Extra technical information displayed in the error panel. */
    public info: { method?: string; url?: string; requestId?: string; platformError?: string; body?: string } = {},
  ) {
    super(typeof (details as { message?: unknown })?.message === 'string' ? (details as { message: string }).message : code);
  }
}

let session: SessionInfo | undefined;
let renew: (() => Promise<SessionInfo>) | undefined;

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const url = `/api${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, 'network_error', { message: `Backend unreachable: ${e instanceof Error ? e.message : String(e)}` }, { method, url });
  }
  if (res.status === 401 && retry && renew && path !== '/session') {
    session = await renew();
    return request<T>(method, path, body, false);
  }
  const text = await res.text();
  let json: Record<string, unknown> | undefined;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = undefined;
  }
  if (!res.ok || json === undefined) {
    const info = {
      method,
      url,
      requestId: res.headers.get('x-request-id') ?? res.headers.get('x-vercel-id') ?? undefined,
      platformError: res.headers.get('x-vercel-error') ?? undefined,
      body: json === undefined ? text.slice(0, 1500) : undefined,
    };
    // Not JSON: the API did not run (platform error page, wrong route, proxy...).
    const code = String(json?.error ?? (json === undefined ? (info.platformError ?? 'non_json_response') : `http_${res.status}`));
    const details = json ?? { message: `HTTP ${res.status} ${res.statusText} – the response is not JSON (the API function probably did not start)` };
    const err = new ApiError(res.status, code, details, info);
    console.error('[dpmultileg] API error', { status: res.status, code, ...info, details });
    throw err;
  }
  return json as T;
}

export const api = {
  health: () => request<Record<string, unknown> & { ok: boolean; mock: boolean; allow_unsigned: boolean }>('GET', '/health'),
  async openSession(payload: Record<string, unknown>): Promise<SessionInfo> {
    renew = async () => request<SessionInfo>('POST', '/session', payload, false);
    session = await renew();
    return session;
  },
  environments: (siteId: string) =>
    request<{ environments: { site_id: string; environment: string; label: string | null }[] }>('GET', `/standalone/environments?site_id=${encodeURIComponent(siteId)}`),
  referential: () => request<Referential>('GET', '/referential'),
  searchItems: (pattern: string, lang: string, start = 0) => request<{ items: Item[]; total: number }>('POST', '/items/search', { pattern, lang, start, limit: 20 }),
  searchEndpoints: (query: string) => request<{ endpoints: Endpoint[] }>('POST', '/endpoints/search', { query }),
  deliveryPromises: (body: Record<string, unknown>) =>
    request<{ request: Record<string, unknown>; response: { delivery_options?: PromiseOption[] } }>('POST', '/delivery_promises', body),
};
