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
  ) {
    super(code);
  }
}

let session: SessionInfo | undefined;
let renew: (() => Promise<SessionInfo>) | undefined;

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && renew && path !== '/session') {
    session = await renew();
    return request<T>(method, path, body, false);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'error'), json);
  return json as T;
}

export const api = {
  health: () => request<{ ok: boolean; mock: boolean; allow_unsigned: boolean }>('GET', '/health'),
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
