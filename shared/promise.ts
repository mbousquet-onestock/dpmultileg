/**
 * Local delivery promise: rebuilt from the OneStock configuration (delivery configs, routes, zones, priorities,
 * restrictions) and the stock, without calling GET /delivery_promises.
 *
 * Steps, for each delivery method of the sales channel:
 *  1. configuration: the delivery config of the method whose delivery zones contain the destination;
 *  2. candidate schemas: chains of routes (multi-leg) from a stock zone to the destination (buildSchemas);
 *  3. exclusions per item: carrier restrictions (item filter), route parcel constraints (weight / dimensions);
 *  4. stock: stock locations of the origin zone holding the quantity (on hand stock);
 *  5. ranking: priorities of the configuration (e.g. the fastest), one shipment preferred, then split up to the
 *     authorized number of shipments;
 *  6. dates: request time + operations of the configuration + transit of the legs (timetables are not evaluated).
 */
import {
  buildSchemas,
  configsFor,
  criterionValue,
  destinationInZone,
  isClickAndCollect,
  prioritiesFor,
  restrictionsForRoute,
  sameCarrier,
  schemaCost,
  zoneEndpoints,
  type LogisticSchema,
  type StockLine,
  type ZoneContext,
} from './logistics.js';
import type { DeliveryConfig, DeliveryRestriction, DeliveryRoute, Destination, Item, LineItem, PromiseOption, PromiseRoute, SortOrder } from './types.js';

export interface PromiseInput {
  salesChannel: string;
  lines: LineItem[];
  destination: Destination;
  /** Delivery methods to evaluate (all the methods of the channel when empty). */
  methods?: string[];
  /** Reference time (unix seconds). */
  from: number;
  configs: DeliveryConfig[];
  routes: DeliveryRoute[];
  ctx: ZoneContext;
  sortOrders: SortOrder[];
  restrictions: DeliveryRestriction[];
  items: Map<string, Item>;
  /** Stock lines; null when the stock could not be read (stock is then assumed available). */
  stock: StockLine[] | null;
  price?: number;
}

export type ExclusionKind = 'restriction' | 'constraint' | 'no_stock';

export interface SchemaAnalysis {
  schema: LogisticSchema;
  /** Shipment index (0 based) of the promise using this schema, -1 when not used. */
  shipment: number;
  /** Shipments of the promise using this schema: stock location and lines carried. */
  shipments: { index: number; endpoint: string; lines: LineItem[] }[];
  /** Stock locations of the origin zone holding each line. */
  stock: { item_id: string; qty: number; endpoints: { id: string; quantity: number }[] }[];
  /** Why the schema can not serve some lines. */
  exclusions: { kind: ExclusionKind; item_id?: string; text: string }[];
  eta_start: number;
  eta_end: number;
  cost?: number;
}

export interface LocalPromiseOption extends PromiseOption {
  config?: DeliveryConfig;
  analysis: SchemaAnalysis[];
  /** Operations hours added to the transit. */
  operations_hours: number;
  /** Served by the stock of the collection store, without transport. */
  local_pickup?: boolean;
  /** The stock could not be read: availability not verified. */
  stock_unverified?: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

/** Parse an execution time: "2h", "30m", "1d", "PT2H30M", "02:30", or a number of minutes. */
export function parseDurationHours(v: unknown): number {
  if (typeof v === 'number') return v / 60;
  if (typeof v !== 'string') return 0;
  const s = v.trim().toUpperCase();
  const iso = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (iso && s !== 'P') return Number(iso[1] ?? 0) * 24 + Number(iso[2] ?? 0) + Number(iso[3] ?? 0) / 60 + Number(iso[4] ?? 0) / 3600;
  const hm = s.match(/^(\d+):(\d{2})$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  let total = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(D|H|M|MIN|S)\b/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === 'D' ? n * 24 : m[2] === 'H' ? n : m[2] === 'S' ? n / 3600 : n / 60;
  }
  if (matched) return total;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) / 60 : 0;
}

/** Hours of the operations of a configuration (at start + shipment, or collection store ones for a local pickup). */
export function operationsHours(config: DeliveryConfig, localPickup = false): number {
  const ops = (config.operations ?? {}) as Record<string, string[]>;
  const times = (config.global_execution_times ?? {}) as Record<string, unknown>;
  let hours = 0;
  for (const [type, list] of Object.entries(ops)) {
    const t = type.toLowerCase();
    const fromStore = /collection|fulfil|fulfill/.test(t);
    if (localPickup ? !(fromStore || /start/.test(t)) : fromStore && !/receiv/.test(t)) continue;
    for (const op of list ?? []) hours += parseDurationHours(times[op]);
  }
  return hours;
}

function attr(item: Item | undefined, ...names: string[]): unknown[] | undefined {
  const a = item?.attributes ?? {};
  for (const n of names) {
    const k = Object.keys(a).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k) return Array.isArray(a[k]) ? a[k] : [a[k]];
  }
  return undefined;
}

function compare(op: string, actual: unknown, expected: unknown): boolean {
  const o = op.toLowerCase();
  const num = (x: unknown) => (typeof x === 'number' ? x : Number(x));
  const eq = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
  switch (o) {
    case '=':
    case '==':
    case 'eq':
      return Array.isArray(expected) ? expected.some((e) => eq(actual, e)) : eq(actual, expected);
    case '!=':
    case 'ne':
    case 'neq':
      return !eq(actual, expected);
    case '>':
    case 'gt':
      return num(actual) > num(expected);
    case '>=':
    case 'gte':
      return num(actual) >= num(expected);
    case '<':
    case 'lt':
      return num(actual) < num(expected);
    case '<=':
    case 'lte':
      return num(actual) <= num(expected);
    case 'in':
      return Array.isArray(expected) && expected.some((e) => eq(actual, e));
    case 'nin':
    case 'not_in':
      return Array.isArray(expected) && !expected.some((e) => eq(actual, e));
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    default:
      return eq(actual, expected);
  }
}

/** Does a restriction item filter apply to an item? Empty filter = every item. Undefined when not evaluable. */
export function restrictionMatchesItem(r: DeliveryRestriction, item: Item | undefined): boolean | undefined {
  const f = r.item_filter;
  const hasCategory = !!f?.category?.length;
  const features = Object.entries(f?.feature ?? {});
  if (!hasCategory && !features.length) return true;
  if (!item) return undefined;
  if (hasCategory && (item.category_ids ?? []).some((c) => f!.category!.some((x) => c === x || c.startsWith(`${x}>`)))) return true;
  for (const [name, conds] of features) {
    const values = attr(item, name);
    if (!values) continue;
    for (const cond of Object.values(conds ?? {})) {
      if (values.some((v) => compare(cond.op, v, cond.value))) return true;
    }
  }
  if (!item.attributes && !item.category_ids) return undefined;
  return false;
}

/** Evaluate route parcel constraints ("sumW <= 30") for the lines of a shipment. Undefined when not evaluable. */
export function constraintFailure(route: DeliveryRoute, lines: LineItem[], items: Map<string, Item>): string | undefined {
  const c = (route.constraints ?? {}) as { parcel_constraints?: { formula?: string; op?: string; value?: number }[] };
  for (const p of c.parcel_constraints ?? []) {
    if (!p.formula || p.value === undefined || !p.op) continue;
    const m = p.formula.match(/^(sum|max|min)(W|d1|d2|d3|V)$/i);
    if (!m) continue;
    const key = m[2].toLowerCase();
    const names = key === 'w' ? ['weight', 'W', 'poids'] : key === 'v' ? ['volume', 'V'] : key === 'd1' ? ['d1', 'length', 'longueur'] : key === 'd2' ? ['d2', 'width', 'largeur'] : ['d3', 'height', 'hauteur'];
    const values = lines.map((l) => {
      const v = Number(attr(items.get(l.item_id), ...names)?.[0]);
      return Number.isFinite(v) ? { v, qty: l.qty } : undefined;
    });
    if (values.some((v) => v === undefined)) continue;
    const list = values as { v: number; qty: number }[];
    const agg = m[1].toLowerCase() === 'sum' ? list.reduce((s, x) => s + x.v * x.qty, 0) : m[1].toLowerCase() === 'max' ? Math.max(...list.map((x) => x.v)) : Math.min(...list.map((x) => x.v));
    if (!compare(p.op, agg, p.value)) return `${p.formula} = ${Math.round(agg * 100) / 100} (${p.op} ${p.value})`;
  }
  return undefined;
}

const AVAILABLE = new Set(['on_hand', 'available', 'physical', 'stock', '']);

function stockOf(stock: StockLine[], endpoint: string, item: string): number {
  return stock.filter((s) => s.endpoint_id === endpoint && s.item_id === item && AVAILABLE.has(s.type ?? '')).reduce((n, s) => n + s.quantity, 0);
}

/** Comparator implementing the priorities (estimated criteria values). */
function byPriorities(order: SortOrder) {
  return (a: LogisticSchema, b: LogisticSchema) => {
    for (const c of order.sort_criterias ?? []) {
      const va = criterionValue(a, c.field);
      const vb = criterionValue(b, c.field);
      if (va === undefined || vb === undefined || va === vb) continue;
      return c.desc ? vb - va : va - vb;
    }
    return a.legs.length - b.legs.length;
  };
}

/** Configuration of a method for the channel and the destination. */
export function configForDestination(configs: DeliveryConfig[], method: string, salesChannel: string, destination: Destination, ctx: ZoneContext) {
  const candidates = configsFor(configs, salesChannel).filter((c) => c.delivery_method === method);
  return (
    candidates.find((c) => c.delivery_zone_ids?.some((z) => destinationInZone(ctx.zones.get(z), destination, ctx))) ??
    candidates.find((c) => !c.delivery_zone_ids?.length)
  );
}

/** Origin endpoints that may be involved for the given methods (to load their stock). */
export function candidateEndpoints(input: Omit<PromiseInput, 'stock' | 'from' | 'items' | 'lines'>): string[] {
  const ids = new Set<string>();
  const methods = input.methods?.length ? input.methods : [...new Set(configsFor(input.configs, input.salesChannel).map((c) => c.delivery_method))];
  for (const m of methods) {
    const config = configForDestination(input.configs, m, input.salesChannel, input.destination, input.ctx);
    if (!config) continue;
    for (const s of buildSchemas(config, input.destination, input.routes, input.ctx, { maxLegs: 3, limit: 50 }))
      for (const e of zoneEndpoints(input.ctx.zones.get(s.originZoneId ?? ''), input.ctx)) ids.add(e.id);
  }
  if (input.destination.endpoint_id) ids.add(input.destination.endpoint_id);
  return [...ids];
}

/* ------------------------------------------------------------------------------------------------
 * Engine
 * ---------------------------------------------------------------------------------------------- */

export function computePromise(input: PromiseInput): LocalPromiseOption[] {
  const methods = input.methods?.length ? input.methods : [...new Set(configsFor(input.configs, input.salesChannel).map((c) => c.delivery_method))];
  return methods.map((m) => computeOption(input, m));
}

function computeOption(input: PromiseInput, method: string): LocalPromiseOption {
  const { destination, lines, ctx, items, from } = input;
  const base = { delivery_method: method, destination, analysis: [] as SchemaAnalysis[], operations_hours: 0 };
  const config = configForDestination(input.configs, method, input.salesChannel, destination, ctx);
  if (!config) return { ...base, status: 'none', reason: 'missing_config' };
  if (lines.some((l) => !items.has(l.item_id))) return { ...base, config, status: 'none', reason: 'invalid_item' };

  const stockUnverified = input.stock === null;
  const stock = input.stock ?? [];
  const order = prioritiesFor(config, input.sortOrders, input.salesChannel).order;
  const applied = config.applied_restrictions?.length ? input.restrictions.filter((r) => config.applied_restrictions!.includes(r.id)) : input.restrictions;
  const maxShipments = config.authorized_shipment_number ?? 4;
  const opsHours = operationsHours(config);

  // 1-2. candidate schemas, sorted by priorities
  const schemas = buildSchemas(config, destination, input.routes, ctx, { maxLegs: 3, limit: 50 }).sort(byPriorities(order));

  // 3-4. exclusions and stock per schema
  const analysis: SchemaAnalysis[] = schemas.map((schema) => {
    const exclusions: SchemaAnalysis['exclusions'] = [];
    const originEndpoints = zoneEndpoints(ctx.zones.get(schema.originZoneId ?? ''), ctx).map((e) => e.id);
    const stockLines = lines.map((l) => ({
      item_id: l.item_id,
      qty: l.qty,
      endpoints: stockUnverified
        ? originEndpoints.map((id) => ({ id, quantity: NaN }))
        : originEndpoints.map((id) => ({ id, quantity: stockOf(stock, id, l.item_id) })).filter((e) => e.quantity >= l.qty),
    }));
    for (const l of lines) {
      for (const leg of schema.legs) {
        for (const r of restrictionsForRoute(leg.route, applied)) {
          if (restrictionMatchesItem(r, items.get(l.item_id)) === true)
            exclusions.push({ kind: 'restriction', item_id: l.item_id, text: `${leg.route.carrier.name} · ${leg.route.carrier.option} : ${r.description ?? r.id}` });
        }
        const failure = constraintFailure(leg.route, [l], items);
        if (failure) exclusions.push({ kind: 'constraint', item_id: l.item_id, text: `${leg.route.carrier.name} · ${leg.route.carrier.option} : ${failure}` });
      }
      if (!stockUnverified && !stockLines.find((s) => s.item_id === l.item_id)!.endpoints.length)
        exclusions.push({ kind: 'no_stock', item_id: l.item_id, text: '' });
    }
    return {
      schema,
      shipment: -1,
      shipments: [],
      stock: stockLines,
      exclusions,
      eta_start: from + Math.round((opsHours + schema.minHours) * 3600),
      eta_end: from + Math.round((opsHours + schema.maxHours) * 3600),
      cost: schemaCost(schema),
    };
  });

  const canServe = (a: SchemaAnalysis, item: string) => !a.exclusions.some((e) => e.item_id === item);

  // Click & collect served by the stock of the collection store itself (no transport).
  if (isClickAndCollect(config) && destination.endpoint_id && !stockUnverified && lines.every((l) => stockOf(stock, destination.endpoint_id!, l.item_id) >= l.qty)) {
    const h = operationsHours(config, true);
    return {
      ...base,
      config,
      analysis,
      operations_hours: h,
      local_pickup: true,
      status: 'valid',
      eta_start: from + Math.round(h * 3600),
      eta_end: from + Math.round(h * 3600),
      cost: 0,
      shipment_number: 1,
      delivery_routes: [],
    };
  }
  if (!schemas.length) return { ...base, config, analysis, operations_hours: opsHours, status: 'none', reason: 'no_eligible_route' };

  // 5. allocation: one shipment serving every line if possible, else split (best schema first) within the limit.
  type Shipment = { a: SchemaAnalysis; endpoint: string; lines: LineItem[] };
  const shipments: Shipment[] = [];
  const endpointFor = (a: SchemaAnalysis, ls: LineItem[]) =>
    a.stock.find((s) => s.item_id === ls[0].item_id)?.endpoints.find((e) => ls.every((l) => a.stock.find((s) => s.item_id === l.item_id)?.endpoints.some((x) => x.id === e.id)))?.id;

  const single = analysis.find((a) => lines.every((l) => canServe(a, l.item_id)) && endpointFor(a, lines));
  if (single) shipments.push({ a: single, endpoint: endpointFor(single, lines)!, lines: [...lines] });
  else {
    let remaining = [...lines];
    while (remaining.length && shipments.length < maxShipments) {
      // the best ranked schema/location serving the largest group of remaining lines
      let best: Shipment | undefined;
      for (const a of analysis) {
        const servable = remaining.filter((l) => canServe(a, l.item_id));
        if (!servable.length) continue;
        for (const e of a.stock.flatMap((s) => s.endpoints.map((x) => x.id))) {
          const group = servable.filter((l) => a.stock.find((s) => s.item_id === l.item_id)?.endpoints.some((x) => x.id === e));
          if (group.length && (!best || group.length > best.lines.length)) best = { a, endpoint: e, lines: group };
        }
      }
      if (!best) break;
      shipments.push(best);
      remaining = remaining.filter((l) => !best!.lines.includes(l));
    }
  }

  const served = shipments.flatMap((s) => s.lines);
  const excluded = lines.filter((l) => !served.includes(l));
  if (!shipments.length) {
    const restricted = analysis.every((a) => a.exclusions.some((e) => e.kind !== 'no_stock'));
    return { ...base, config, analysis, operations_hours: opsHours, status: 'none', reason: restricted ? 'no_eligible_route' : 'no_stock', stock_unverified: stockUnverified };
  }
  if (excluded.length && shipments.length >= maxShipments && !single) {
    // more shipments would be needed than authorized
    if (!served.length) return { ...base, config, analysis, operations_hours: opsHours, status: 'none', reason: 'exceeds_authorized_shipment_number' };
  }
  shipments.forEach((s, i) => {
    if (s.a.shipment < 0) s.a.shipment = i;
    s.a.shipments.push({ index: i, endpoint: s.endpoint, lines: s.lines });
  });

  // 6. dates, cost and routes
  const deliveryRoutes: PromiseRoute[] = shipments.flatMap((s) => {
    let cumulMin = opsHours;
    let cumulMax = opsHours;
    return s.a.schema.legs.map((leg, idx) => {
      cumulMin += leg.route.minimum_transit_hours ?? 0;
      cumulMax += leg.route.maximum_transit_hours ?? leg.route.minimum_transit_hours ?? 0;
      return {
        id: leg.route.id,
        carrier: leg.route.carrier,
        origin_zone_id: leg.route.origin_zone_id,
        destination_zone_id: leg.route.destination_zone_id,
        origin_endpoint_id: idx === 0 ? s.endpoint : undefined,
        items: s.lines.map((l) => ({ id: l.item_id, quantity: l.qty })),
        eta_start: from + Math.round(cumulMin * 3600),
        eta_end: from + Math.round(cumulMax * 3600),
        metric_values: leg.route.metric_values,
      };
    });
  });
  const cost = shipments.reduce((sum, s) => sum + (s.a.cost ?? 0), 0);
  const carbon = shipments.reduce((sum, s) => sum + (criterionValue(s.a.schema, 'carbon_footprint') ?? 0), 0);

  return {
    ...base,
    config,
    analysis,
    operations_hours: opsHours,
    stock_unverified: stockUnverified,
    status: excluded.length ? 'partial' : 'valid',
    eta_start: Math.max(...shipments.map((s) => s.a.eta_start)),
    eta_end: Math.max(...shipments.map((s) => s.a.eta_end)),
    cost: Math.round(cost * 100) / 100,
    carbon_footprint: carbon || undefined,
    shipment_number: shipments.length,
    line_items: excluded.length ? served : undefined,
    excluded_line_items: excluded.length ? excluded : undefined,
    delivery_routes: deliveryRoutes,
  };
}

