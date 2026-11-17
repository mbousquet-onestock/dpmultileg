import { Router, type NextFunction, type Request, type Response } from 'express';
import { asList } from '../../shared/normalize.js';
import type { DeliveryConfig, DeliveryRoute, Endpoint, Item, SalesChannel, Zone } from '../../shared/types.js';
import { config } from './config.js';
import {
  deleteCredential,
  listCredentials,
  resolveApiUrl,
  resolveCredential,
  upsertCredential,
  validateInput,
  type CredentialInput,
} from './credentials.js';
import { cached, callOnestock, OnestockError } from './onestock.js';
import { issueSession, requireSession, type SessionClaims } from './session.js';
import { verifyExtensionSignature } from './signature.js';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) => h(req, res).catch(next);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const target = (s: SessionClaims) => ({ site_id: s.site_id, environment: s.environment, api_url: s.api_url });

export function apiRouter(): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ ok: true, mock: config.mockOnestock, allow_unsigned: config.allowUnsigned });
  });

  /* ---------------------------------------------------------------- session (extension handshake) */

  r.post(
    '/session',
    wrap(async (req, res) => {
      const body = req.body ?? {};
      const siteId = str(body.site_id);
      const userId = str(body.user_id) ?? 'anonymous';
      const apiUrl = str(body.api_url);
      if (!siteId) return res.status(400).json({ error: 'missing_site_id' });

      const cred =
        (await resolveCredential(siteId, apiUrl, str(body.environment))) ??
        // Demo mode: no OneStock call is made, credentials are not needed.
        (config.mockOnestock
          ? { site_id: siteId, environment: str(body.environment) ?? 'demo', api_url: 'https://demo.api.mock.onestock-retail.com', user_id: 'demo', password: '', extension_secrets: [], label: 'demo' }
          : undefined);
      if (!cred) return res.status(412).json({ error: 'missing_credentials', site_id: siteId, api_url: apiUrl ?? null });

      const signed = verifyExtensionSignature(
        { extension_signature: str(body.extension_signature), extension_id: str(body.extension_id), user_id: userId },
        cred.extension_secrets,
        config.signatureMaxAgeSeconds,
      );
      if (!signed && !(config.allowUnsigned && cred.extension_secrets.length === 0)) {
        return res.status(403).json({ error: 'invalid_signature' });
      }

      const resolvedApiUrl = resolveApiUrl(cred, apiUrl);
      if (!resolvedApiUrl) return res.status(412).json({ error: 'missing_api_url', site_id: siteId, environment: cred.environment });

      const session = await issueSession({
        sub: userId,
        site_id: siteId,
        environment: cred.environment,
        api_url: resolvedApiUrl,
        extension_id: str(body.extension_id),
        lang: str(body.lang),
      });
      return res.json({ ...session, site_id: siteId, environment: cred.environment, signed, mock: config.mockOnestock });
    }),
  );

  /** Standalone mode (outside the OneStock iframe, dev only): list environments configured for a site. */
  r.get('/standalone/environments', async (req, res) => {
    if (!config.allowUnsigned) return res.status(403).json({ error: 'forbidden' });
    const siteId = str(req.query.site_id);
    const environments = (await listCredentials(siteId)).map((c) => ({ site_id: c.site_id, environment: c.environment, label: c.label }));
    if (config.mockOnestock && !environments.some((e) => e.environment === 'demo'))
      environments.push({ site_id: siteId ?? '', environment: 'demo', label: 'Démo (mock)' });
    return res.json({ environments });
  });

  /* ---------------------------------------------------------------- OneStock data (authenticated) */

  r.use(['/referential', '/endpoints', '/items', '/delivery_promises'], (req, res, next) => {
    void requireSession(req, res, next);
  });

  r.get(
    '/referential',
    wrap(async (req, res) => {
      const t = target(req.session!);
      const [configs, routes, zones, salesChannels] = await Promise.all([
        cached(t, 'delivery_configs', async () => asList<DeliveryConfig>(await callOnestock(t, 'GET', '/delivery_configs'), 'delivery_configs')),
        cached(t, 'delivery_routes', async () => asList<DeliveryRoute>(await callOnestock(t, 'GET', '/delivery_routes'), 'delivery_routes')),
        cached(t, 'zones', async () => asList<Zone>(await callOnestock(t, 'GET', '/zones'), 'zones')),
        cached(t, 'sales_channels', async () => {
          try {
            return asList<SalesChannel>(await callOnestock(t, 'GET', '/sales_channels'), 'sales_channels', 'sales_channel');
          } catch {
            return [] as SalesChannel[]; // optional: fall back to the ids found in delivery configs
          }
        }),
      ]);
      // Stock locations explicitly referenced by zones, to draw the schema (origins / hubs / stores).
      const endpointIds = [...new Set(zones.flatMap((z) => z.included_endpoint_ids ?? []))];
      const endpoints = endpointIds.length
        ? await cached(t, `endpoints:${endpointIds.join(',')}`, async () => fetchEndpoints(t, { endpoint_ids: endpointIds }))
        : [];
      res.json({ delivery_configs: configs, delivery_routes: routes, zones, sales_channels: salesChannels, endpoints });
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
        features: ['name', 'image', 'image_url', 'price', 'color', 'size'],
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
      const result = await callOnestock(t, 'GET', '/delivery_promises', payload);
      res.json({ request: payload, response: result });
    }),
  );

  /* ---------------------------------------------------------------- admin: credentials */

  const admin = Router();
  admin.use((req, res, next) => {
    if (!config.adminToken) return res.status(404).json({ error: 'admin_disabled' });
    if (req.header('authorization') !== `Bearer ${config.adminToken}`) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  admin.get('/credentials', async (req, res) => {
    res.json({ credentials: await listCredentials(str(req.query.site_id)) });
  });
  admin.put('/credentials/:site_id/:environment', async (req, res) => {
    const input: CredentialInput = { ...req.body, site_id: req.params.site_id, environment: req.params.environment };
    const err = validateInput(input);
    if (err) return res.status(400).json({ error: err });
    await upsertCredential(input);
    res.json({ ok: true, credentials: (await listCredentials(input.site_id)).find((c) => c.environment === input.environment) });
  });
  admin.delete('/credentials/:site_id/:environment', async (req, res) => {
    res.status((await deleteCredential(req.params.site_id, req.params.environment)) ? 204 : 404).end();
  });
  r.use('/admin', admin);

  /* ---------------------------------------------------------------- errors */

  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof OnestockError) {
      return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: 'onestock_error', status: err.status, message: err.message, details: err.body });
    }
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err instanceof Error ? err.message : String(err) });
  });

  return r;
}

async function fetchEndpoints(t: { site_id: string; environment: string; api_url: string }, filter: Record<string, unknown>): Promise<Endpoint[]> {
  const res = await callOnestock(t, 'GET', '/endpoints', {
    ...filter,
    fields: ['_id', 'name', 'classification', 'timezone', 'address', 'address.zip_code', 'address.city', 'address.regions'],
    pagination: { start: 0, limit: 100 },
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
  };
}
