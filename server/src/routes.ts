import { Router, type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { collectStockLines } from '../../shared/logistics.js';
import { normalizeTimetable, type ExecutionTime, type ScheduledEvent, type Timetable } from '../../shared/timetables.js';
import { asList, normalizeRoutes } from '../../shared/normalize.js';
import type { DeliveryConfig, DeliveryRestriction, DeliveryRoute, Endpoint, Item, SalesChannel, SortOrder, Zone } from '../../shared/types.js';
import { config, configProblems } from './config.js';
import { getStore } from './db.js';
import { errorFields, log } from './logger.js';
import {
  deleteCredential,
  environmentFromApiUrl,
  getCredential,
  isAllowedApiUrl,
  listCredentials,
  resolveApiUrl,
  resolveCredential,
  upsertCredential,
  validateInput,
  type CredentialInput,
} from './credentials.js';
import { cached, callOnestock, clearSiteCaches, OnestockError, testLogin } from './onestock.js';
import { issueSession, readSession, requireSession, type SessionClaims } from './session.js';
import { verifyExtensionSignature } from './signature.js';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) => h(req, res).catch(next);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const target = (s: SessionClaims) => ({ site_id: s.site_id, environment: s.environment, api_url: s.api_url });

export function apiRouter(): Router {
  const r = Router();

  /** Diagnostics (no secret): configuration problems, storage, runtime. */
  r.get('/health', async (req, res) => {
    const problems = configProblems();
    let storage: Record<string, unknown> = { kind: config.databaseUrl ? 'postgres' : 'sqlite' };
    if (!problems.length) {
      try {
        const store = await getStore();
        const rows = await store.list();
        storage = { kind: store.kind, ok: true, credentials: rows.map((c) => `${c.site_id}/${c.environment}`) };
      } catch (e) {
        storage = { ...storage, ok: false, error: e instanceof Error ? e.message : String(e) };
        log('error', 'storage_unavailable', { request_id: req.requestId, ...errorFields(e) });
      }
    }
    res.json({
      ok: !problems.length && storage.ok !== false,
      problems,
      storage,
      mock: config.mockOnestock,
      allow_unsigned: config.allowUnsigned,
      verify_signature: config.verifySignature,
      admin_protected: !!config.adminToken,
      runtime: {
        node: process.version,
        vercel: config.onVercel,
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
      request_id: req.requestId,
    });
  });

  /* ---------------------------------------------------------------- session (extension handshake) */

  r.post(
    '/session',
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const siteId = str(body.site_id);
      const userId = str(body.user_id) ?? 'anonymous';
      const apiUrl = str(body.api_url);
      const ctx = {
        request_id: req.requestId,
        site_id: siteId,
        user_id: userId,
        extension_id: str(body.extension_id),
        api_url_host: apiUrl ? safeHost(apiUrl) : undefined,
        environment_requested: str(body.environment),
        has_signature: !!str(body.extension_signature),
      };
      log('info', 'session_request', ctx);
      if (!siteId) return res.status(400).json({ error: 'missing_site_id', message: 'site_id is missing from the extension URL parameters and the handshake data' });

      const cred =
        (await resolveCredential(siteId, apiUrl, str(body.environment))) ??
        // Demo mode: no OneStock call is made, credentials are not needed.
        (config.mockOnestock
          ? { site_id: siteId, environment: str(body.environment) ?? 'demo', api_url: 'https://demo.api.mock.onestock-retail.com', user_id: 'demo', password: '', extension_secrets: [], label: 'demo' }
          : undefined);
      if (!cred) {
        const known = (await listCredentials(siteId)).map((c) => c.environment);
        log('warn', 'session_missing_credentials', { ...ctx, known_environments: known });
        return res.status(412).json({
          error: 'missing_credentials',
          message: `No credentials stored for site ${siteId} matching ${apiUrl ?? 'no api_url'} (configured environments for this site: ${known.join(', ') || 'none'})`,
          site_id: siteId,
          api_url: apiUrl ?? null,
          environment_guess: apiUrl ? (environmentFromApiUrl(apiUrl) ?? null) : null,
          known_environments: known,
        });
      }

      const signed =
        config.verifySignature &&
        verifyExtensionSignature(
        { extension_signature: str(body.extension_signature), extension_id: str(body.extension_id), user_id: userId },
        cred.extension_secrets,
        config.signatureMaxAgeSeconds,
      );
      if (config.verifySignature && !signed && !(config.allowUnsigned && cred.extension_secrets.length === 0)) {
        const reason = !str(body.extension_signature)
          ? 'no extension_signature received in onestock_data'
          : cred.extension_secrets.length === 0
            ? `no extension secret stored for ${siteId}/${cred.environment} (and ALLOW_UNSIGNED is false)`
            : 'signature does not match the stored secrets, or is older than the allowed age';
        log('warn', 'session_invalid_signature', { ...ctx, environment: cred.environment, secrets: cred.extension_secrets.length, reason });
        return res.status(403).json({ error: 'invalid_signature', message: reason, environment: cred.environment });
      }

      const resolvedApiUrl = resolveApiUrl(cred, apiUrl);
      if (!resolvedApiUrl) {
        log('warn', 'session_missing_api_url', { ...ctx, environment: cred.environment });
        return res.status(412).json({
          error: 'missing_api_url',
          message: `No api_url stored for ${siteId}/${cred.environment} and the handshake api_url is not an allowed OneStock host`,
          site_id: siteId,
          environment: cred.environment,
        });
      }
      log('info', 'session_opened', { ...ctx, environment: cred.environment, signed, api_url_host: safeHost(resolvedApiUrl) });

      const session = await issueSession({
        sub: userId,
        site_id: siteId,
        environment: cred.environment,
        api_url: resolvedApiUrl,
        extension_id: str(body.extension_id),
        lang: str(body.lang),
        signed,
      });
      return res.json({ ...session, site_id: siteId, environment: cred.environment, signed, mock: config.mockOnestock });
    }),
  );

  /** Standalone mode (outside the OneStock iframe, dev only): list environments configured for a site. */
  r.get('/standalone/environments', async (req, res) => {
    if (config.verifySignature && !config.allowUnsigned) return res.status(403).json({ error: 'forbidden' });
    const siteId = str(req.query.site_id);
    const environments = (await listCredentials(siteId)).map((c) => ({ site_id: c.site_id, environment: c.environment, label: c.label }));
    if (config.mockOnestock && !environments.some((e) => e.environment === 'demo'))
      environments.push({ site_id: siteId ?? '', environment: 'demo', label: 'Démo (mock)' });
    return res.json({ environments });
  });

  /* ---------------------------------------------------------------- OneStock data (authenticated) */

  r.use(['/referential', '/endpoints', '/items', '/delivery_promises', '/stocks'], (req, res, next) => {
    void requireSession(req, res, next);
  });

  r.get(
    '/referential',
    wrap(async (req, res) => {
      const t = target(req.session!);
      const [configs, routes, zones, salesChannels] = await Promise.all([
        cached(t, 'delivery_configs', async () => asList<DeliveryConfig>(await callOnestock(t, 'GET', '/delivery_configs'), 'delivery_configs')),
        cached(t, 'delivery_routes', async () => normalizeRoutes(await callOnestock(t, 'GET', '/delivery_routes'))),
        cached(t, 'zones', async () => asList<Zone>(await callOnestock(t, 'GET', '/zones'), 'zones')),
        cached(t, 'sales_channels', async () => {
          try {
            return asList<SalesChannel>(await callOnestock(t, 'GET', '/sales_channels'), 'sales_channels', 'sales_channel');
          } catch {
            return [] as SalesChannel[]; // optional: fall back to the ids found in delivery configs
          }
        }),
      ]);
      // All stock locations: zones may be geographic (countries, zip codes) and the local delivery promise
      // needs every candidate origin. Paginated, capped to keep the referential reasonable.
      const endpoints = await cached(t, 'endpoints:all', async () => {
        const all: Endpoint[] = [];
        for (let start = 0; start < 3000; start += 100) {
          const page = await fetchEndpoints(t, {}, start);
          all.push(...page);
          if (page.length < 100) break;
        }
        // Endpoints referenced by zones but not returned (other pagination, filters...)
        const missing = [...new Set(zones.flatMap((z) => z.included_endpoint_ids ?? []))].filter((id) => !all.some((e) => e.id === id));
        if (missing.length) all.push(...(await fetchEndpoints(t, { endpoint_ids: missing.slice(0, 100) }, 0)));
        return all;
      });
      // Optional referential explaining the choices (internal routes: tolerate missing rights / versions).
      const optional = async <T extends { id: string }>(name: string, path: string, key: string): Promise<T[]> =>
        cached(t, name, async () => {
          try {
            return asList<T>(await callOnestock(t, 'GET', path), key);
          } catch (e) {
            log('warn', 'optional_referential_unavailable', { request_id: req.requestId, path, error: e instanceof Error ? e.message : String(e) });
            return [] as T[];
          }
        });
      // Execution times of the operations (duration + execution_time_timetable).
      const executionTimes = optional<ExecutionTime>('execution_times', '/execution_times', 'execution_times');
      const [sortOrders, restrictions, timetables, scheduledEvents, executionTimesList] = await Promise.all([
        optional<SortOrder>('sort_orders', '/sort_orders', 'sort_orders'),
        optional<DeliveryRestriction>('delivery_restrictions', '/delivery_restrictions', 'delivery_restrictions'),
        cached(t, 'timetables', async () =>
          fetchCarrierTimetables(
            t,
            routes,
            req.requestId,
            (await executionTimes).map((e) => e.timetable_id).filter((x): x is string => !!x),
          ),
        ),
        cached(t, 'scheduled_events', async () => {
          try {
            const now = Math.floor(Date.now() / 1000);
            return asList<ScheduledEvent>(
              await callOnestock(t, 'GET', '/scheduledevents', { filters: { from: now - 86400, to: now + 60 * 86400 } }),
              'scheduled_events',
            );
          } catch (e) {
            log('warn', 'optional_referential_unavailable', { request_id: req.requestId, path: '/scheduledevents', error: e instanceof Error ? e.message : String(e) });
            return [] as ScheduledEvent[];
          }
        }),
        executionTimes,
      ]);
      res.json({
        delivery_configs: configs,
        delivery_routes: routes,
        zones,
        sales_channels: salesChannels,
        endpoints,
        sort_orders: sortOrders,
        delivery_restrictions: restrictions,
        timetables,
        scheduled_events: scheduledEvents,
        execution_times: executionTimesList,
      });
    }),
  );

  r.post(
    '/endpoints/search',
    wrap(async (req, res) => {
      const t = target(req.session!);
      const q = str(req.body?.query);
      const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]).slice(0, 100) : undefined;
      const endpoints = await fetchEndpoints(t, { ...(ids?.length ? { endpoint_ids: ids } : {}), ...(q ? { name: q } : {}) });
      res.json({ endpoints });
    }),
  );

  r.post(
    '/items/search',
    wrap(async (req, res) => {
      const t = target(req.session!);
      const lang = str(req.body?.lang) ?? req.session!.lang ?? 'en';
      const pattern = str(req.body?.pattern);
      const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]).slice(0, 100) : undefined;
      const payload: Record<string, unknown> = {
        // Weight / dimensions / flags are needed to evaluate carrier restrictions and parcel constraints.
        features: ['name', 'image', 'image_url', 'price', 'color', 'size', 'weight', 'W', 'length', 'width', 'height', 'd1', 'd2', 'd3', 'volume', 'bulky', 'hazardous', 'category'],
        lang,
        get_total: true,
        pagination: { start: Number(req.body?.start ?? 0), limit: Math.min(Number(req.body?.limit ?? 20), 50) },
      };
      if (ids?.length) payload.item_ids = ids;
      if (pattern) {
        payload.pattern = pattern;
        payload.searchable_fields = [
          { name: 'id', priority: 1 },
          { name: 'name', priority: 2 },
        ];
      }
      const result = (await callOnestock<{ items?: unknown; total?: number }>(t, 'GET', '/items', payload)) ?? {};
      const items = asList<Item>(result, 'items').map((i) => simplifyItem(i, lang));
      res.json({ items, total: result.total ?? items.length });
    }),
  );

  r.post(
    '/delivery_promises',
    wrap(async (req, res) => {
      const t = target(req.session!);
      const b = req.body ?? {};
      if (!str(b.sales_channel)) return res.status(400).json({ error: 'missing_sales_channel' });
      if (!Array.isArray(b.delivery_options) || !b.delivery_options.length) return res.status(400).json({ error: 'missing_delivery_options' });
      const payload: Record<string, unknown> = {
        sales_channel: b.sales_channel,
        line_items: (b.line_items ?? []).map((l: { item_id: string; qty: number }) => ({ item_id: String(l.item_id), qty: Number(l.qty) || 1 })),
        delivery_options: b.delivery_options,
        fields: ['delivery_options.delivery_routes', 'delivery_options.excluded_line_items'],
      };
      if (typeof b.price === 'number') payload.pricing_details = { price: b.price };
      if (typeof b.from === 'number') payload.from = b.from;
      // Detailed OneStock computation (sort order, restrictions, routes, stocks used) for the explanation panel.
      if (b.debug === true) payload.debug = { all: true };
      const result = await callOnestock(t, 'GET', '/delivery_promises', payload);
      res.json({ request: payload, response: result });
    }),
  );

  /** Stock of some items in some stock locations (used to explain why a schema is chosen or not). */
  r.post(
    '/stocks',
    wrap(async (req, res) => {
      const t = target(req.session!);
      const itemIds = Array.isArray(req.body?.item_ids) ? (req.body.item_ids as unknown[]).map(String).slice(0, 50) : [];
      const endpointIds = Array.isArray(req.body?.endpoint_ids) ? (req.body.endpoint_ids as unknown[]).map(String).slice(0, 500) : [];
      if (!itemIds.length || !endpointIds.length) return res.json({ stocks: [] });
      const result = await callOnestock(t, 'GET', '/stocks', { item_ids: itemIds, endpoint_ids: endpointIds });
      res.json({ stocks: collectStockLines(result) });
    }),
  );

  /* ---------------------------------------------------------------- admin: credentials */

  const admin = Router();
  /**
   * Who may manage credentials:
   *  - anyone presenting the ADMIN_TOKEN (first setup, standalone use), for every site;
   *  - a back office user who opened the extension from OneStock with a valid signature, for his own site only
   *    (OneStock authenticated him and the extension anchor is restricted to the configured roles).
   */
  admin.use(async (req, res, next) => {
    // No ADMIN_TOKEN configured: the configuration screen is open (deployment owner's choice, see README).
    if (!config.adminToken) return next();
    const header = req.header('authorization') ?? '';
    const given = Buffer.from(header);
    const expected = Buffer.from(`Bearer ${config.adminToken}`);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    if (header.startsWith('Bearer ')) {
      try {
        const s = await readSession(header.slice(7));
        if (s.signed) {
          const site = str((req.params as Record<string, string>).site_id) ?? str(req.body?.site_id) ?? str(req.query.site_id);
          const urlSite = req.path.match(/^\/credentials\/([^/]+)\//)?.[1];
          const targetSite = urlSite ? decodeURIComponent(urlSite) : site;
          if (!targetSite || targetSite === s.site_id) {
            res.locals.adminSite = s.site_id;
            return next();
          }
          return res.status(403).json({ error: 'forbidden', message: `This OneStock session can only configure site ${s.site_id}` });
        }
      } catch {
        /* not a session token */
      }
    }
    log('warn', 'admin_unauthorized', { request_id: req.requestId, path: req.path });
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid admin password' });
  });
  admin.get('/credentials', async (req, res) => {
    res.json({ credentials: await listCredentials((res.locals.adminSite as string | undefined) ?? str(req.query.site_id)) });
  });
  admin.put('/credentials/:site_id/:environment', async (req, res) => {
    const { site_id, environment } = req.params as { site_id: string; environment: string };
    const existing = await getCredential(site_id, environment);
    const input: CredentialInput = {
      site_id,
      environment,
      user_id: str(req.body?.user_id) ?? existing?.user_id ?? '',
      // Empty password = keep the stored one (it is never sent back to the browser).
      password: (typeof req.body?.password === 'string' && req.body.password) || existing?.password || '',
      api_url: str(req.body?.api_url) ?? null,
      extension_secrets: Array.isArray(req.body?.extension_secrets) ? (req.body.extension_secrets as string[]).map((x) => String(x).trim()).filter(Boolean) : null,
      label: str(req.body?.label) ?? null,
    };
    const err = validateInput(input);
    if (err) return res.status(400).json({ error: 'invalid_input', message: err });
    await upsertCredential(input);
    clearSiteCaches(site_id, environment);
    log('info', 'credentials_saved', { request_id: req.requestId, site_id, environment, user_id: input.user_id, secrets_updated: !!input.extension_secrets?.length });
    res.json({ ok: true, credentials: (await listCredentials(site_id)).find((c) => c.environment === environment) });
  });
  admin.delete('/credentials/:site_id/:environment', async (req, res) => {
    const { site_id, environment } = req.params as { site_id: string; environment: string };
    const deleted = await deleteCredential(site_id, environment);
    clearSiteCaches(site_id, environment);
    if (deleted) log('info', 'credentials_deleted', { request_id: req.requestId, site_id, environment });
    res.status(deleted ? 204 : 404).end();
  });
  /** Check a user/password against OneStock POST /login without saving anything. */
  admin.post('/credentials/test', async (req, res) => {
    const b = req.body ?? {};
    const siteId = str(b.site_id);
    const environment = str(b.environment);
    if (!siteId || !environment) return res.status(400).json({ error: 'invalid_input', message: 'site_id and environment are required' });
    const existing = await getCredential(siteId, environment);
    const userId = str(b.user_id) ?? existing?.user_id;
    const password = (typeof b.password === 'string' && b.password) || existing?.password;
    if (!userId || !password) return res.status(400).json({ error: 'invalid_input', message: 'user_id and password are required' });
    const explicit = str(b.api_url);
    if (explicit && !isAllowedApiUrl(explicit)) return res.status(400).json({ error: 'invalid_input', message: `api_url host must match ${config.allowedApiHost}` });
    const apiUrl =
      explicit ??
      resolveApiUrl(
        { site_id: siteId, environment, api_url: existing?.api_url ?? null, user_id: userId, password, extension_secrets: [], label: null },
        str(b.handshake_api_url),
      );
    if (!apiUrl) return res.status(400).json({ error: 'missing_api_url', message: 'api_url is required for this environment' });
    try {
      await testLogin(apiUrl, siteId, userId, password);
      log('info', 'credentials_test_ok', { request_id: req.requestId, site_id: siteId, environment, api_host: new URL(apiUrl).host });
      res.json({ ok: true, api_url: apiUrl });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log('warn', 'credentials_test_failed', { request_id: req.requestId, site_id: siteId, environment, api_host: new URL(apiUrl).host, message });
      res.json({ ok: false, api_url: apiUrl, message });
    }
  });
  r.use('/admin', admin);

  /* ---------------------------------------------------------------- errors */

  r.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const base = { request_id: req.requestId, path: req.path, site_id: req.session?.site_id, environment: req.session?.environment };
    if (err instanceof OnestockError) {
      log('warn', 'onestock_error', { ...base, onestock_status: err.status, onestock_path: err.path, onestock_request_id: err.requestId, message: err.message });
      // 401/403 from OneStock are about our API user, not the extension session: don't let the front think its session expired.
      const status = err.status === 401 || err.status === 403 ? 502 : err.status >= 400 && err.status < 600 ? err.status : 502;
      return res.status(status).json({
        error: 'onestock_error',
        status: err.status,
        message: err.message,
        onestock_path: err.path,
        onestock_request_id: err.requestId,
        details: err.body,
        request_id: req.requestId,
      });
    }
    log('error', 'internal_error', { ...base, ...errorFields(err) });
    res.status(500).json({ error: 'internal_error', message: err instanceof Error ? err.message : String(err), request_id: req.requestId });
  });

  return r;
}

const CARRIER_TIMETABLE_TYPES = ['carrier_pickup_timetable', 'carrier_transit_timetable', 'carrier_delivery_timetable', 'execution_time_timetable'];

/**
 * Carrier timetables with their weekly slots (hours.timespans). GET /timetables is called per type; timetables
 * referenced by the routes but returned without hours are fetched one by one (GET /timetables/{id}).
 */
async function fetchCarrierTimetables(
  t: { site_id: string; environment: string; api_url: string },
  routes: DeliveryRoute[],
  requestId?: string,
  extraIds: string[] = [],
): Promise<Timetable[]> {
  // 1. list per type (ids, names, types: the list does not return the slots)
  const byId = new Map<string, Timetable>();
  for (const type of CARRIER_TIMETABLE_TYPES) {
    try {
      const res = await callOnestock(t, 'GET', '/timetables', { filters: { type } });
      for (const tt of asList<Timetable>(res, 'timetables')) byId.set(tt.id, { ...tt, type: tt.type ?? type });
    } catch (e) {
      log('warn', 'optional_referential_unavailable', { request_id: requestId, path: `/timetables (${type})`, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // timetables referenced by the routes / execution times but absent from the lists
  for (const r of routes)
    for (const [k, v] of Object.entries(r as unknown as Record<string, unknown>))
      if (/timetable/i.test(k)) for (const id of Array.isArray(v) ? v : [v]) if (typeof id === 'string' && id && !byId.has(id)) byId.set(id, { id });
  for (const id of extraIds) if (!byId.has(id)) byId.set(id, { id });

  // 2. detail of each timetable: slots (hours / current_timetable) and routes using it
  const ids = [...byId.keys()].slice(0, 200);
  for (let i = 0; i < ids.length; i += 10) {
    await Promise.all(
      ids.slice(i, i + 10).map(async (id) => {
        try {
          const res = await callOnestock(t, 'GET', `/timetables/${encodeURIComponent(id)}`, {
            fields: ['id', 'name', 'type', 'hours', 'current_timetable', 'routes'],
          });
          const tt = normalizeTimetable(res, id);
          if (tt) byId.set(id, { ...byId.get(id), ...tt, type: tt.type ?? byId.get(id)?.type });
        } catch (e) {
          log('warn', 'timetable_unavailable', { request_id: requestId, timetable_id: id, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  }
  const list = [...byId.values()];
  log('info', 'timetables_loaded', {
    request_id: requestId,
    count: list.length,
    with_slots: list.filter((x) => x.hours?.timespans?.length).length,
    linked_to_routes: list.filter((x) => Array.isArray(x.routes) && x.routes.length).length,
  });
  return list;
}

async function fetchEndpoints(t: { site_id: string; environment: string; api_url: string }, filter: Record<string, unknown>, start = 0): Promise<Endpoint[]> {
  const res = await callOnestock(t, 'GET', '/endpoints', {
    ...filter,
    fields: ['_id', 'name', 'classification', 'timezone', 'address', 'address.zip_code', 'address.city', 'address.regions', 'opening_hours', 'execution_times'],
    pagination: { start, limit: 100 },
  });
  return asList<Endpoint>(res, 'endpoints');
}

function simplifyItem(i: Item, lang: string): Item {
  const f = i.features?.[lang] ?? i.features?.en ?? Object.values(i.features ?? {})[0] ?? {};
  const first = (k: string) => (Array.isArray(f[k]) ? f[k][0] : f[k]) as string | undefined;
  return {
    id: i.id,
    product_id: i.product_id,
    name: first('name') ?? i.name,
    image: first('image_url') ?? first('image') ?? i.image,
    price: first('price') ?? i.price,
    category_ids: i.category_ids,
    attributes: f as Record<string, unknown[]>,
  };
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid_url';
  }
}
