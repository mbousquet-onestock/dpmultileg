/**
 * Fake OneStock API used when MOCK_ONESTOCK=true (local development & demo).
 * The dataset describes a fashion retailer in France with multi-leg routes:
 *   warehouse -> Paris hub -> same day delivery in Ile-de-France
 *   warehouse -> Marseille hub -> ferry to Corsica
 *   warehouse -> stores shuttle -> click & collect
 */
import { buildSchemas, criterionValue, deliveryMethods, prioritiesFor, zoneEndpoints, type ZoneContext } from '../../shared/logistics.js';
import type {
  DeliveryConfig,
  DeliveryRoute,
  Destination,
  Endpoint,
  Item,
  LineItem,
  PromiseOption,
  SalesChannel,
  Zone,
} from '../../shared/types.js';

export const mockZones: Zone[] = [
  { id: 'z_wh_tls', name: 'Entrepôt Toulouse', included_endpoint_ids: ['WH_TLS'], type: 'expedition' },
  { id: 'z_hub_paris', name: 'Hub Paris Gennevilliers', included_endpoint_ids: ['HUB_PAR'], type: 'expedition' },
  { id: 'z_hub_mrs', name: 'Hub Marseille', included_endpoint_ids: ['HUB_MRS'], type: 'expedition' },
  { id: 'z_stores_fr', name: 'Magasins France', included_endpoint_ids: ['ST_PARIS', 'ST_LYON', 'ST_TLS', 'ST_AJA'], type: 'expedition' },
  { id: 'z_stores_idf', name: 'Magasins Île-de-France', included_endpoint_ids: ['ST_PARIS'], type: 'expedition' },
  { id: 'z_fr', name: 'France continentale', country_codes: ['FR'], excluded_zip_code: '^20', type: 'delivery' },
  { id: 'z_corse', name: 'Corse', country_codes: ['FR'], zip_code: '^20', type: 'delivery' },
  { id: 'z_idf', name: 'Île-de-France', country_codes: ['FR'], zip_code: '^(75|77|78|91|92|93|94|95)', type: 'delivery' },
  { id: 'z_eu', name: 'Union européenne', country_codes: ['BE', 'DE', 'ES', 'IT', 'NL', 'LU', 'PT'], type: 'delivery' },
  { id: 'z_fr_all', name: 'France (toutes zones)', included_zones: ['z_fr', 'z_corse'], type: 'delivery' },
];

export const mockEndpoints: Endpoint[] = [
  ep('WH_TLS', 'Entrepôt Toulouse', 'Toulouse', '31000', ['warehouse']),
  ep('HUB_PAR', 'Hub Paris Gennevilliers', 'Gennevilliers', '92230', ['hub']),
  ep('HUB_MRS', 'Hub Marseille Port', 'Marseille', '13002', ['hub']),
  ep('ST_PARIS', 'Magasin Paris Rivoli', 'Paris', '75001', ['store']),
  ep('ST_LYON', 'Magasin Lyon Part-Dieu', 'Lyon', '69003', ['store']),
  ep('ST_TLS', 'Magasin Toulouse Capitole', 'Toulouse', '31000', ['store']),
  ep('ST_AJA', 'Magasin Ajaccio', 'Ajaccio', '20000', ['store']),
];

function ep(id: string, name: string, city: string, zip: string, classification: string[]): Endpoint {
  return {
    id,
    name,
    classification,
    timezone: 'Europe/Paris',
    address: { city, zip_code: zip, regions: { country: { code: 'FR', name: 'France' } } },
  };
}

const r = (
  id: string,
  name: string,
  option: string,
  origin: string,
  dest: string,
  min: number,
  max: number,
  extra: Partial<DeliveryRoute> = {},
): DeliveryRoute => ({
  id,
  carrier: { name, option },
  origin_zone_id: origin,
  destination_zone_id: dest,
  minimum_transit_hours: min,
  maximum_transit_hours: max,
  ...extra,
});

export const mockRoutes: DeliveryRoute[] = [
  r('r_wh_fr_colissimo', 'colissimo', 'home', 'z_wh_tls', 'z_fr', 24, 72, { pickup_timetable_id: 'tt_colissimo_pickup', delivery_timetable_id: 'tt_colissimo_delivery', opening_timetable_id: 'tt_trucks_weekdays', metric_values: { cost_by_parcel: 6.5, shipping_fees: 4.99 } }),
  r('r_wh_eu_dhl', 'dhl', 'express', 'z_wh_tls', 'z_eu', 48, 96, { metric_values: { cost_by_parcel: 14 } }),
  r('r_wh_hub_paris', 'geodis', 'linehaul', 'z_wh_tls', 'z_hub_paris', 12, 24, { pickup_timetable_id: 'tt_geodis_pickup', opening_timetable_id: 'tt_trucks_weekdays', metric_values: { cost_by_parcel: 1.2 } }),
  r('r_hub_idf_sdd', 'stuart', 'same_day', 'z_hub_paris', 'z_idf', 2, 6, { pickup_timetable_id: 'tt_stuart_pickup', delivery_timetable_id: 'tt_stuart_delivery', metric_values: { cost_by_parcel: 9, shipping_fees: 9.90 }, constraints: { parcel_constraints: [{ formula: 'sumW', op: '<=', value: 15 }] } }),
  r('r_wh_hub_mrs', 'geodis', 'linehaul', 'z_wh_tls', 'z_hub_mrs', 8, 16, { pickup_timetable_id: 'tt_geodis_pickup', opening_timetable_id: 'tt_trucks_weekdays', metric_values: { cost_by_parcel: 1 } }),
  r('r_hub_corse_ferry', 'corsica_ferries', 'fret', 'z_hub_mrs', 'z_corse', 24, 48, { metric_values: { cost_by_parcel: 7.5 } }),
  r('r_wh_stores_shuttle', 'store_shuttle', 'navette', 'z_wh_tls', 'z_stores_fr', 24, 48, { pickup_timetable_id: 'tt_shuttle_pickup', opening_timetable_id: 'tt_trucks_weekdays', metric_values: { cost_by_parcel: 0.8 } }),
  r('r_stores_idf_sdd', 'stuart', 'same_day', 'z_stores_idf', 'z_idf', 1, 3, { pickup_timetable_id: 'tt_stuart_pickup', delivery_timetable_id: 'tt_stuart_delivery', metric_values: { cost_by_parcel: 8, shipping_fees: 9.90 }, constraints: { parcel_constraints: [{ formula: 'sumW', op: '<=', value: 15 }] } }),
  r('r_stores_fr_colissimo', 'colissimo', 'home', 'z_stores_fr', 'z_fr', 24, 48, { pickup_timetable_id: 'tt_colissimo_pickup', delivery_timetable_id: 'tt_colissimo_delivery', opening_timetable_id: 'tt_trucks_weekdays', metric_values: { cost_by_parcel: 6.9, shipping_fees: 4.99 } }),
  r('r_stores_stores', 'store_shuttle', 'interstore', 'z_stores_fr', 'z_stores_fr', 24, 48, { metric_values: { cost_by_parcel: 1.5 } }),
];

/* Carrier timetables (seconds from Monday 00:00, Europe/Paris) */
const H = 3600;
const D = 24 * H;
const weekdays = (from: number, to: number, days = [0, 1, 2, 3, 4]) => days.map((d) => ({ start: d * D + from * H, end: d * D + to * H, options: { open: true } }));
const tt = (id: string, name: string, type: string, timespans: { start: number; end: number; options: { open: boolean } }[]) => ({
  id,
  name,
  type,
  hours: { timezone: 'Europe/Paris', timespans },
});
export const mockTimetables = [
  tt('tt_colissimo_pickup', 'Colissimo enlèvement 16h-17h', 'carrier_pickup_timetable', weekdays(16, 17)),
  tt('tt_colissimo_delivery', 'Colissimo livraison lun-sam 8h-18h', 'carrier_delivery_timetable', weekdays(8, 18, [0, 1, 2, 3, 4, 5])),
  tt('tt_trucks_weekdays', 'Camions lun-ven', 'carrier_transit_timetable', weekdays(0, 24)),
  tt('tt_geodis_pickup', 'Geodis enlèvement 18h-19h', 'carrier_pickup_timetable', weekdays(18, 19)),
  tt('tt_stuart_pickup', 'Stuart enlèvement 9h-20h', 'carrier_pickup_timetable', weekdays(9, 20, [0, 1, 2, 3, 4, 5, 6])),
  tt('tt_stuart_delivery', 'Stuart créneaux 10h-21h', 'carrier_delivery_timetable', weekdays(10, 21, [0, 1, 2, 3, 4, 5, 6])),
  tt('tt_shuttle_pickup', 'Navette enlèvement 7h-8h', 'carrier_pickup_timetable', weekdays(7, 8)),
  tt('tt_ops_france', 'France', 'execution_time_timetable', weekdays(9, 18)),
];
export const mockExecutionTimes = [
  { id: 'et_pick_pack_1h', name: 'Préparation 1h', operation: 'pick_pack', duration: '1h', execution_moment: 'before_shipping', timetable_id: 'tt_ops_france' },
  { id: 'et_validation_30m', name: 'Validation 30 min', operation: 'validation', duration: '30m', execution_moment: 'always_at_start', timetable_id: 'tt_ops_france' },
];
export const mockScheduledEvents = [
  {
    id: 'ev_armistice',
    name: 'Armistice (pas de livraison Colissimo)',
    type: 'bank_holiday',
    start: 1794956400, // 2026-11-11 00:00 Europe/Paris
    end: 1795042800,
    options: { open: false },
    timetable_types: ['carrier_delivery_timetable'],
    links: { carriers: ['colissimo'] },
  },
];

export const mockConfigs: DeliveryConfig[] = [
  {
    id: 'cfg_hd_std',
    name: 'Livraison à domicile standard',
    delivery_method: 'HD_standard',
    sales_channel_id: 'ecom_fr',
    carriers: [
      { name: 'colissimo', option: 'home' },
      { name: 'dhl', option: 'express' },
      { name: 'corsica_ferries', option: 'fret' },
    ],
    delivery_zone_ids: ['z_fr', 'z_corse', 'z_eu'],
    authorized_shipment_number: 2,
    operations: { always_at_start: ['validation'], before_shipping: ['pick_pack'] },
    global_execution_times: { validation: 'et_validation_30m', pick_pack: 'et_pick_pack_1h' },
  },
  {
    id: 'cfg_sdd',
    name: 'Livraison le jour même',
    delivery_method: 'SDD',
    sales_channel_id: 'ecom_fr',
    carriers: [{ name: 'stuart', option: 'same_day' }],
    delivery_zone_ids: ['z_idf'],
    authorized_shipment_number: 1,
    sort_order: { sort_criterias: [{ field: 'eta_end', desc: false }] },
    operations: { before_shipping: ['pick_pack'] },
    global_execution_times: { pick_pack: 'et_pick_pack_1h' },
    applied_restrictions: ['res_bulky_courier'],
  },
  {
    id: 'cfg_ckc',
    name: 'Click & Collect',
    type: 'click_and_collect',
    delivery_method: 'CKC',
    sales_channel_id: 'ecom_fr',
    carriers: [
      { name: 'store_shuttle', option: 'navette' },
      { name: 'store_shuttle', option: 'interstore' },
    ],
    delivery_zone_ids: ['z_stores_fr'],
    authorized_shipment_number: 1,
  },
  {
    id: 'cfg_ois_hd',
    name: 'Commande en magasin livrée à domicile',
    delivery_method: 'HD_standard',
    sales_channel_id: 'sc_order_in_store',
    carriers: [{ name: 'colissimo', option: 'home' }],
    delivery_zone_ids: ['z_fr'],
    authorized_shipment_number: 2,
  },
  {
    id: 'cfg_ois_ckc',
    name: 'Commande en magasin retirée en magasin',
    type: 'click_and_collect',
    delivery_method: 'CKC',
    sales_channel_id: 'sc_order_in_store',
    carriers: [
      { name: 'store_shuttle', option: 'navette' },
      { name: 'store_shuttle', option: 'interstore' },
    ],
    delivery_zone_ids: ['z_stores_fr'],
  },
];

export const mockSortOrders = [
  { id: 'so_sdd', delivery_method: 'SDD', sales_channel: 'ecom_fr', sort_criterias: [{ field: 'eta_end', desc: false }, { field: 'cost', desc: false }] },
  { id: 'so_hd', delivery_method: 'HD_standard', sales_channel: 'ecom_fr', sort_criterias: [{ field: 'cost', desc: false }, { field: 'eta_end', desc: false }] },
];

export const mockRestrictions = [
  {
    id: 'res_bulky_courier',
    description: 'Articles hors gabarit interdits en coursier et navette',
    carrier_blacklist: [
      { name: 'stuart', option: 'same_day' },
      { name: 'store_shuttle', option: 'navette' },
    ],
    item_filter: { feature: { bulky: { '': { op: '=', value: true } } } },
  },
];

export const mockSalesChannels: SalesChannel[] = [
  { id: 'ecom_fr', name: 'E-commerce France', currency: 'EUR', timezone: 'Europe/Paris' },
  { id: 'sc_order_in_store', name: 'SC Order In Store', currency: 'EUR', timezone: 'Europe/Paris' },
];

const item = (id: string, name: string, price: number, color: string, weight = 1, bulky = false): Item => {
  const f = { name: [name], price: [String(price)], color: [color], weight: [weight], bulky: [bulky] };
  // weight is an item field (GET /items fields: weight), not a feature
  const { weight: _w, ...features } = f;
  return { id, product_id: id.split('_').slice(0, 2).join('_'), category_ids: [bulky ? 'home>furniture' : 'fashion'], weight, features: { fr: features, en: features } };
};

export const mockItems: Item[] = [
  item('TSHIRT_BASIC_WH_M', 'T-shirt basique blanc', 19.9, 'Blanc'),
  item('TSHIRT_BASIC_BK_L', 'T-shirt basique noir', 19.9, 'Noir'),
  item('JEAN_SLIM_IND_32', 'Jean slim indigo', 69, 'Indigo'),
  item('SNEAKER_RUN_WH_42', 'Sneakers running blanches', 99, 'Blanc'),
  item('SNEAKER_RUN_BK_43', 'Sneakers running noires', 99, 'Noir'),
  item('PARKA_WINTER_KK_M', 'Parka hiver kaki', 189, 'Kaki', 2),
  item('BAG_LEATHER_BR', 'Sac cuir marron', 149, 'Marron'),
  item('SCARF_WOOL_RD', 'Écharpe laine rouge', 39, 'Rouge'),
  item('WATCH_STEEL_SV', 'Montre acier', 249, 'Argent'),
  item('SOFA_3P_GR', 'Canapé 3 places (hors gabarit)', 899, 'Gris', 65, true),
];

/** Stock per endpoint (absent = 0). */
const stock: Record<string, Record<string, number>> = {
  WH_TLS: Object.fromEntries(mockItems.filter((i) => i.id !== 'WATCH_STEEL_SV').map((i) => [i.id, 50])),
  ST_PARIS: { TSHIRT_BASIC_WH_M: 3, SNEAKER_RUN_WH_42: 2, WATCH_STEEL_SV: 1, SCARF_WOOL_RD: 4 },
  ST_LYON: { JEAN_SLIM_IND_32: 2, WATCH_STEEL_SV: 2 },
  ST_TLS: { PARKA_WINTER_KK_M: 1 },
  ST_AJA: { TSHIRT_BASIC_BK_L: 5 },
};

const ctx: ZoneContext = {
  zones: new Map(mockZones.map((z) => [z.id, z])),
  endpoints: new Map(mockEndpoints.map((e) => [e.id, e])),
};

function pick<T extends { id: string }>(list: T[], body: Record<string, unknown>): T[] {
  const ids = body.ids as string[] | undefined;
  return ids?.length ? list.filter((x) => ids.includes(x.id)) : list;
}

function searchItems(body: Record<string, unknown>) {
  const pattern = String(body.pattern ?? '').toLowerCase();
  const itemIds = (body.item_ids ?? (body.filters as { ids?: string[] } | undefined)?.ids) as string[] | undefined;
  const pagination = (body.pagination ?? {}) as { limit?: number; start?: number };
  let list = mockItems;
  if (itemIds?.length) list = list.filter((i) => itemIds.includes(i.id));
  if (pattern)
    list = list.filter((i) => i.id.toLowerCase().includes(pattern) || String(i.features?.fr?.name?.[0] ?? '').toLowerCase().includes(pattern));
  const start = pagination.start ?? 0;
  const limit = pagination.limit ?? 20;
  return { items: list.slice(start, start + limit), total: list.length, pagination: { start, limit } };
}

function deliveryPromises(body: Record<string, unknown>): { delivery_options: PromiseOption[] } {
  const salesChannel = body.sales_channel as string;
  const lineItems = (body.line_items ?? []) as LineItem[];
  const from = (body.from as number | undefined) ?? Math.floor(Date.now() / 1000);
  const wantRoutes = ((body.fields as string[] | undefined) ?? []).includes('delivery_options.delivery_routes');
  const requested = (body.delivery_options ?? []) as { delivery_method: string; destination: Destination; authorized_shipment_number?: number }[];
  const price = ((body.pricing_details as { price?: number } | undefined)?.price ?? 0) as number;

  const options = requested.map((req): PromiseOption => {
    const base = { delivery_method: req.delivery_method, destination: req.destination };
    const config = deliveryMethods(mockConfigs, salesChannel).find((c) => c.delivery_method === req.delivery_method);
    if (!config) return { ...base, status: 'none', reason: 'missing_config' };
    if (lineItems.some((l) => !mockItems.some((i) => i.id === l.item_id))) return { ...base, status: 'none', reason: 'invalid_item' };

    const schemas = buildSchemas(config, req.destination, mockRoutes, ctx, { maxLegs: 3 });
    if (!schemas.length) return { ...base, status: 'none', reason: 'no_eligible_route' };

    // Allocate each line on the fastest schema whose origin holds the stock.
    type Alloc = { item: LineItem; schema: (typeof schemas)[number]; endpoint: string };
    const allocations: Alloc[] = [];
    const excluded: LineItem[] = [];
    for (const line of lineItems) {
      if (line.item_id === 'SOFA_3P_GR' && config.delivery_method !== 'HD_standard') {
        excluded.push(line);
        continue;
      }
      let found: Alloc | undefined;
      // Rank the combinations with the configured sort order, like OneStock.
      const order = prioritiesFor(config, mockSortOrders, salesChannel).order;
      const ranked = [...schemas].sort((a, b) => {
        for (const c of order?.sort_criterias ?? [{ field: 'eta_end', desc: false }]) {
          const va = criterionValue(a, c.field) ?? 0;
          const vb = criterionValue(b, c.field) ?? 0;
          if (va !== vb) return c.desc ? vb - va : va - vb;
        }
        return 0;
      });
      for (const s of ranked) {
        const origin = zoneEndpoints(ctx.zones.get(s.originZoneId ?? ''), ctx).find(
          (e) => (stock[e.id]?.[line.item_id] ?? 0) >= line.qty && (!isStoreToStoreOnly(s) || e.id !== destEndpoint(req.destination)),
        );
        if (origin) {
          found = { item: line, schema: s, endpoint: origin.id };
          break;
        }
      }
      if (found) allocations.push(found);
      else excluded.push(line);
    }
    if (!allocations.length) return { ...base, status: 'none', reason: 'no_stock' };

    const shipmentsKeys = new Set(allocations.map((a) => `${a.endpoint}>${a.schema.legs.map((l) => l.route.id).join(',')}`));
    const maxShipments = req.authorized_shipment_number ?? config.authorized_shipment_number ?? 4;
    if (shipmentsKeys.size > maxShipments) return { ...base, status: 'none', reason: 'exceeds_authorized_shipment_number' };

    const maxH = Math.max(...allocations.map((a) => a.schema.maxHours));
    const minH = Math.max(...allocations.map((a) => a.schema.minHours));
    const cost = [...shipmentsKeys].reduce((sum, k) => {
      const a = allocations.find((x) => `${x.endpoint}>${x.schema.legs.map((l) => l.route.id).join(',')}` === k)!;
      return sum + a.schema.legs.reduce((s, l) => s + (l.route.metric_values?.cost_by_parcel ?? 0), 0);
    }, 0);

    const option: PromiseOption = {
      ...base,
      status: excluded.length ? 'partial' : 'valid',
      eta_start: from + minH * 3600 + 3 * 3600,
      eta_end: from + maxH * 3600 + 3 * 3600,
      cutoff: from + 2 * 3600,
      cost: price >= 100 ? 0 : Math.round(cost * 100) / 100,
      carbon_footprint: allocations.reduce((s, a) => s + a.schema.legs.length * 450, 0),
      shipment_number: shipmentsKeys.size,
    };
    if (excluded.length) {
      option.line_items = allocations.map((a) => a.item);
      option.excluded_line_items = excluded;
    }
    if (wantRoutes) {
      option.delivery_routes = allocations.flatMap((a) =>
        a.schema.legs.map((l, idx) => {
          const previous = a.schema.legs.slice(0, idx + 1);
          return {
            id: l.route.id,
            carrier: l.route.carrier,
            origin_endpoint_id: idx === 0 ? a.endpoint : undefined,
            items: allocations.filter((x) => x.endpoint === a.endpoint && x.schema === a.schema).map((x) => ({ id: x.item.item_id, quantity: x.item.qty })),
            eta_start: from + previous.reduce((s, p) => s + (p.route.minimum_transit_hours ?? 0), 0) * 3600 + 3 * 3600,
            eta_end: from + previous.reduce((s, p) => s + (p.route.maximum_transit_hours ?? 0), 0) * 3600 + 3 * 3600,
            metric_values: l.route.metric_values,
          };
        }),
      );
      // Same leg shared by several items of the same shipment: keep one entry.
      const seen = new Set<string>();
      option.delivery_routes = option.delivery_routes.filter((pr) => {
        const k = `${pr.id}|${JSON.stringify(pr.items)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    return option;
  });
  return { delivery_options: options };
}

const destEndpoint = (d: Destination) => d.endpoint_id;
const isStoreToStoreOnly = (s: { legs: { route: DeliveryRoute }[] }) => s.legs.length === 1 && s.legs[0].route.id === 'r_stores_stores';

export function mockOnestock(method: string, path: string, body: Record<string, unknown>): unknown {
  const p = path.split('?')[0];
  const resDetail = p.match(/^\/delivery_restrictions\/(.+)$/);
  if (resDetail) {
    const r = mockRestrictions.find((x) => x.id === decodeURIComponent(resDetail[1]));
    if (!r) throw new Error('mock: restriction not found');
    return { delivery_restriction: r };
  }
  const etDetail = p.match(/^\/execution_times\/(.+)$/);
  if (etDetail) {
    const et = mockExecutionTimes.find((x) => x.id === decodeURIComponent(etDetail[1]));
    if (!et) throw new Error('mock: execution time not found');
    return { execution_time: et };
  }
  const ttDetail = p.match(/^\/timetables\/(.+)$/);
  if (ttDetail) {
    const tt = mockTimetables.find((x) => x.id === decodeURIComponent(ttDetail[1]));
    if (!tt) throw new Error('mock: timetable not found');
    // Same shape as OneStock with fields current_timetable / routes
    const routes = mockRoutes.filter((r) => Object.entries(r).some(([k, v]) => /timetable/.test(k) && v === tt.id)).map((r) => r.id);
    return { timetable: { id: tt.id, name: tt.name, type: tt.type, current_timetable: { hours: tt.hours }, routes } };
  }
  if (method !== 'GET') throw new Error(`mock: ${method} ${p} not supported`);
  switch (p) {
    case '/delivery_configs':
      return { delivery_configs: pick(mockConfigs, body) };
    case '/delivery_routes':
      return { delivery_routes: pick(mockRoutes, body) };
    case '/zones':
      return { zones: pick(mockZones, body) };
    case '/endpoints': {
      const ids = body.endpoint_ids as string[] | undefined;
      const name = String(body.name ?? '').toLowerCase();
      let list = ids?.length ? mockEndpoints.filter((e) => ids.includes(e.id)) : mockEndpoints;
      if (name) list = list.filter((e) => `${e.id} ${e.name}`.toLowerCase().includes(name));
      const start = ((body.pagination as { start?: number } | undefined)?.start ?? 0) as number;
      return { endpoints: list.slice(start, start + 100) };
    }
    case '/stocks': {
      const items = (body.item_ids as string[] | undefined) ?? [];
      const eps = (body.endpoint_ids as string[] | undefined) ?? [];
      return {
        stocks: eps.flatMap((e) => items.filter((i) => (stock[e]?.[i] ?? 0) > 0).map((i) => ({ endpoint_id: e, item_id: i, quantity: stock[e][i], type: 'on_hand' }))),
      };
    }
    case '/timetables': {
      const type = (body.filters as { type?: string } | undefined)?.type;
      return { timetables: mockTimetables.filter((x) => !type || x.type === type) };
    }
    case '/execution_times':
      return { execution_times: mockExecutionTimes };
    case '/scheduledevents':
      return { scheduled_events: mockScheduledEvents };
    case '/sort_orders':
      return { sort_orders: mockSortOrders };
    case '/delivery_restrictions':
      return { delivery_restrictions: mockRestrictions };
    case '/sales_channels':
      return { sales_channels: mockSalesChannels };
    case '/items':
    case '/v3/items':
      return searchItems(body);
    case '/delivery_promises':
      return deliveryPromises(body);
    default:
      throw new Error(`mock: GET ${p} not supported`);
  }
}
