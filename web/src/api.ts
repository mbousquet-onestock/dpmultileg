import type { StockLine } from '@shared/logistics';
import type { ExecutionTime, ScheduledEvent, Timetable } from '@shared/timetables';
import type { DeliveryConfig, DeliveryRestriction, DeliveryRoute, Endpoint, Item, PromiseOption, SalesChannel, SortOrder, Zone } from '@shared/types';

export interface Referential {
  delivery_configs: DeliveryConfig[];
  delivery_routes: DeliveryRoute[];
  zones: Zone[];
  sales_channels: SalesChannel[];
  endpoints: Endpoint[];
  sort_orders?: SortOrder[];
  delivery_restrictions?: DeliveryRestriction[];
  timetables?: Timetable[];
  scheduled_events?: ScheduledEvent[];
  execution_times?: ExecutionTime[];
  settings?: Record<string, unknown>;
  load_report?: { step: string; path: string; ok: boolean; count: number; ms: number; detail?: string; error?: string; optional?: boolean; partial?: boolean }[];
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

async function request<T>(method: string, path: string, body?: unknown, retry = true, adminToken?: string): Promise<T> {
  const url = `/api${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : session ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, 'network_error', { message: `Backend unreachable: ${e instanceof Error ? e.message : String(e)}` }, { method, url });
  }
  if (res.status === 401 && retry && renew && path !== '/session' && !adminToken) {
    session = await renew();
    return request<T>(method, path, body, false);
  }
  if (res.status === 204) return {} as T;
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

export interface CredentialSummary {
  site_id: string;
  environment: string;
  api_url: string | null;
  user_id: string;
  has_extension_secrets: boolean;
  label: string | null;
  updated_at: string;
}

export interface CredentialForm {
  site_id: string;
  environment: string;
  user_id: string;
  password?: string;
  api_url?: string;
  extension_secrets?: string[];
  label?: string;
  handshake_api_url?: string;
}

/** Configuration screen: protected by the ADMIN_TOKEN of the server. */
export const adminApi = {
  list: (token: string, siteId?: string) =>
    request<{ credentials: CredentialSummary[] }>('GET', `/admin/credentials${siteId ? `?site_id=${encodeURIComponent(siteId)}` : ''}`, undefined, false, token),
  save: (token: string, f: CredentialForm) =>
    request<{ ok: boolean; credentials: CredentialSummary }>(
      'PUT',
      `/admin/credentials/${encodeURIComponent(f.site_id)}/${encodeURIComponent(f.environment)}`,
      { user_id: f.user_id, password: f.password, api_url: f.api_url, extension_secrets: f.extension_secrets, label: f.label },
      false,
      token,
    ),
  remove: (token: string, siteId: string, environment: string) =>
    request<unknown>('DELETE', `/admin/credentials/${encodeURIComponent(siteId)}/${encodeURIComponent(environment)}`, undefined, false, token),
  getSettings: (token: string, siteId: string, environment: string) =>
    request<{ settings: Record<string, unknown> }>('GET', `/admin/settings/${encodeURIComponent(siteId)}/${encodeURIComponent(environment)}`, undefined, false, token),
  saveSettings: (token: string, siteId: string, environment: string, settings: Record<string, unknown>) =>
    request<{ ok: boolean }>('PUT', `/admin/settings/${encodeURIComponent(siteId)}/${encodeURIComponent(environment)}`, { settings }, false, token),
  test: (token: string, f: CredentialForm) => request<{ ok: boolean; api_url?: string; message?: string }>('POST', '/admin/credentials/test', f, false, token),
};

export const api = {
  health: () => request<Record<string, unknown> & { ok: boolean; mock: boolean; allow_unsigned: boolean }>('GET', '/health'),
  async openSession(payload: Record<string, unknown>): Promise<SessionInfo> {
    renew = async () => request<SessionInfo>('POST', '/session', payload, false);
    session = await renew();
    return session;
  },
  environments: (siteId: string) =>
    request<{ environments: { site_id: string; environment: string; label: string | null }[] }>('GET', `/standalone/environments?site_id=${encodeURIComponent(siteId)}`),
  referential: (refresh = false) => request<Referential>('GET', `/referential${refresh ? '?refresh=1' : ''}`),
  /** Items are fetched 5 by 5 ("Show more" loads the next page). */
  searchItems: (pattern: string, lang: string, start = 0, limit = 5) =>
    request<{ items: Item[]; total: number }>('POST', '/items/search', { pattern, lang, start, limit }),
  stocks: (itemIds: string[], endpointIds: string[]) =>
    request<{ stocks: StockLine[]; source?: string; stock_export_error?: string }>('POST', '/stocks', { item_ids: itemIds, endpoint_ids: endpointIds }),
  /** Items by id (GET /v3/items filters.ids), with their weight and dimensions. */
  itemsByIds: (ids: string[], lang: string) => request<{ items: Item[]; total: number }>('POST', '/items/search', { ids, lang, limit: Math.min(ids.length, 50) }),
  searchEndpoints: (query: string) => request<{ endpoints: Endpoint[] }>('POST', '/endpoints/search', { query }),
  deliveryPromises: (body: Record<string, unknown>) =>
    request<{ request: Record<string, unknown>; response: { delivery_options?: PromiseOption[] } }>('POST', '/delivery_promises', body),
};
