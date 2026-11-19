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
  criterionKind,
  criterionValue,
  destinationInZone,
  isClickAndCollect,
  prioritiesFor,
  settingsPriorities,
  restrictionsForRoute,
  sameCarrier,
  schemaCost,
  zoneEndpoints,
  type LogisticSchema,
  type StockLine,
  type ZoneContext,
} from './logistics.js';
import {
  operationsOf,
  parseDurationHours,
  runOperations,
  timeLegs,
  type ExecutionTime,
  type LegTiming,
  type OperationMoment,
  type OperationTiming,
  type ScheduledEvent,
  type Timetable,
} from './timetables.js';
import type { Constraint, DeliveryConfig, DeliveryRestriction, DeliveryRoute, Destination, Endpoint, Item, LineItem, PromiseOption, PromiseRoute, RouteVariant, SortOrder } from './types.js';

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
  /** Stock per stock request (delivery_configs.stock_request: detailed, detailed_ois...); else `stock` is used. */
  stocks?: Record<string, StockLine[] | null>;
  price?: number;
  /** Carrier timetables (GET /timetables) by id, and scheduled events (GET /scheduledevents). */
  timetables?: Map<string, Timetable>;
  events?: ScheduledEvent[];
  /** Execution times of the operations (GET /execution_times) by id. */
  executionTimes?: Map<string, ExecutionTime>;
  /** Extension settings (priorities per delivery method). */
  settings?: Record<string, unknown>;
  /** Deliver in a minimum of parcels: group the items at an intermediate point after transfers. */
  consolidate?: boolean;
  /**
   * Capacities (GET /capacities): remaining capacity of the day containing `at`, undefined when not known (then
   * unlimited). preparation = order lines a stock location can prepare; carrier = parcels a carrier can load there.
   */
  capacity?: CapacityLookup;
}

export type ExclusionKind = 'restriction' | 'constraint' | 'no_stock' | 'timetable';

export interface SchemaAnalysis {
  schema: LogisticSchema;
  /** Shipment index (0 based) of the promise using this schema, -1 when not used. */
  shipment: number;
  /** Shipments of the promise using this schema: stock location and lines carried. */
  shipments: { index: number; endpoint: string; lines: LineItem[] }[];
  /** Stock locations of the origin zone holding each line. */
  stock: { item_id: string; qty: number; endpoints: { id: string; quantity: number; available_from?: number; available_to?: number }[] }[];
  /** Future stock used by the shipping stock location retained for the timing. */
  future_stock?: FutureStockUse[];
  /** Preparation / pickup postponed by the capacities of the stock location retained for the timing. */
  capacity_delays?: CapacityDelay[];
  /** Why the schema can not serve some lines. */
  exclusions: { kind: ExclusionKind; item_id?: string; text: string }[];
  eta_start: number;
  eta_end: number;
  /** Latest time the parcel must be ready for the first carrier pickup (carrier cutoff), when known. */
  cutoff?: number;
  /** Leg by leg timing (max transit track) with the pickup and delivery slots used. */
  timeline?: LegTiming[];
  /** Operations timed for this schema (at start, preparation at the origin, receiving at the collection store). */
  operations?: OperationTiming[];
  /** Stock location used to time the preparation. */
  timing_endpoint?: string;
  /** Cost table row used for each leg. */
  costs?: { route_id: string; variant_id?: string; conditions?: string; cost?: number; carbon?: number; shipping_fees?: number; unknown: string[] }[];
  carbon?: number;
  /** Shipping fees paid by the customer (metric shipping_fees of the cost table rows). */
  shipping_fees?: number;
  cost?: number;
}

export interface LocalPromiseOption extends PromiseOption {
  config?: DeliveryConfig;
  analysis: SchemaAnalysis[];
  /** Operations hours added to the transit. */
  operations_hours: number;
  /** Shipping fees paid by the customer (sum of the shipping_fees of the selected cost table rows). */
  shipping_fees?: number;
  /** Served by the stock of the collection store, without transport. */
  local_pickup?: boolean;
  /** Operations timed for a local pickup (at start + from destination). */
  local_operations?: OperationTiming[];
  /** The stock could not be read: availability not verified. */
  stock_unverified?: boolean;
  /** Consolidation (option "consolidation"): items grouped at an intermediate point, then one shipment. */
  consolidation?: Consolidation;
  /** Future stock (ASN, purchase orders...) the promise relies on. */
  future_stock?: FutureStockUse[];
  /** Preparation / pickup postponed because a capacity is reached. */
  capacity_delays?: CapacityDelay[];
  /** Consolidation requested but no consolidation point found: the normal allocation is kept. */
  consolidation_failed?: boolean;
}

/** Transfer of an item to the consolidation point. */
export interface ConsolidationTransfer {
  item_id: string;
  qty: number;
  /** Stock location the item is transferred from. */
  from: string;
  schema: LogisticSchema;
  timeline?: LegTiming[];
  /** Arrival at the consolidation point. */
  arrival: number;
  cost?: number;
  carbon?: number;
  capacity_delays?: CapacityDelay[];
}

export interface Consolidation {
  /** Stock location where the items are grouped. */
  point: string;
  /** Final schema (from the consolidation point to the customer). */
  analysis: SchemaAnalysis;
  /** Lines available at the consolidation point. */
  local: LineItem[];
  transfers: ConsolidationTransfer[];
  /** All the items are at the consolidation point and prepared. */
  ready: number;
  timeline?: LegTiming[];
  eta_start: number;
  eta_end: number;
  cost: number;
  carbon?: number;
  shipping_fees?: number;
  capacity_delays?: CapacityDelay[];
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

export { parseDurationHours };

/** Sum of the durations of the operations of a configuration (summary; the timing uses the calendars). */
export function operationsHours(config: DeliveryConfig, localPickup = false): number {
  const moments: OperationMoment[] = localPickup ? ['always_at_start', 'from_destination'] : ['always_at_start', 'before_shipping'];
  return moments.flatMap((m) => operationsOf(config, m)).reduce((h, op) => h + parseDurationHours((config.global_execution_times as Record<string, unknown> | undefined)?.[op]), 0);
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
    // item fields (weight, length, width, height) take precedence over features with the same name
    const field = (item as unknown as Record<string, unknown>)[name];
    const values = typeof field === 'number' ? [field] : attr(item, name);
    if (!values) continue;
    // conditions: an array [{ op, value }] (GET /delivery_restrictions/{id}) or an object of conditions
    for (const cond of (Array.isArray(conds) ? conds : Object.values(conds ?? {})) as { op: string; value?: unknown }[]) {
      if (values.some((v) => compare(cond.op, v, cond.value))) return true;
    }
  }
  if (!item.attributes && !item.category_ids) return undefined;
  return false;
}

/* ------------------------------------------------------------------------------------------------
 * Cost tables (route variants) and constraints
 * ---------------------------------------------------------------------------------------------- */

const WEIGHT = ['weight', 'W', 'poids'];
const DIMS: Record<string, string[]> = { d1: ['d1', 'length', 'longueur'], d2: ['d2', 'width', 'largeur'], d3: ['d3', 'height', 'hauteur'], v: ['volume', 'V'] };

function itemNumber(item: Item | undefined, names: string[]): number | undefined {
  const v = Number(attr(item, ...names)?.[0]);
  return Number.isFinite(v) ? v : undefined;
}

/** Value of a parcel formula for the lines of a shipment: W / sumW (weight), qty, V, d1-d3, with sum/max/min. */
export function parcelValue(formula: string, lines: LineItem[], items: Map<string, Item>): number | undefined {
  const f = formula.trim().toLowerCase();
  if (f === 'qty' || f === 'sumqty' || f === 'quantity') return lines.reduce((n, l) => n + l.qty, 0);
  const m = f.match(/^(sum|max|min)?(w|v|d1|d2|d3)$/);
  if (!m) return undefined;
  const names = m[2] === 'w' ? WEIGHT : DIMS[m[2]];
  const values = lines.map((l) => ({ v: itemNumber(items.get(l.item_id), names), qty: l.qty }));
  if (values.some((x) => x.v === undefined)) return undefined;
  const agg = m[1] ?? (m[2] === 'w' || m[2] === 'v' ? 'sum' : 'max');
  const list = values as { v: number; qty: number }[];
  if (agg === 'sum') return list.reduce((s, x) => s + x.v * x.qty, 0);
  return agg === 'max' ? Math.max(...list.map((x) => x.v)) : Math.min(...list.map((x) => x.v));
}

/** Value of an order constraint: price (order price), qty, weight. */
export function orderValue(name: string, lines: LineItem[], items: Map<string, Item>, orderPrice?: number): number | undefined {
  const n = name.trim().toLowerCase();
  if (n === 'price' || n === 'amount' || n === 'total') return orderPrice;
  if (n === 'qty' || n === 'quantity') return lines.reduce((s, l) => s + l.qty, 0);
  if (n === 'weight' || n === 'w') return parcelValue('W', lines, items);
  return undefined;
}

/** Order price: the price option of the test, else the sum of the item prices. */
export function orderPriceOf(lines: LineItem[], items: Map<string, Item>, price?: number): number | undefined {
  if (price !== undefined) return price;
  const prices = lines.map((l) => Number(items.get(l.item_id)?.price) * l.qty);
  return prices.every((p) => Number.isFinite(p)) ? prices.reduce((a, b) => a + b, 0) : undefined;
}

const OPS: Record<string, string> = { lt: '<', lte: '≤', gt: '>', gte: '≥', eq: '=', ne: '≠' };
export const describeConstraint = (c: Constraint) => `${c.formula ?? c.name} ${OPS[String(c.op).toLowerCase()] ?? c.op} ${c.value}`;

export interface VariantChoice {
  variant?: RouteVariant;
  /** Conditions of the row used ("W < 10, price < 100"). */
  conditions?: string;
  /** Constraints that could not be evaluated (missing item data). */
  unknown: string[];
  /** No row matches: values of the shipment. */
  failure?: string;
}

/**
 * Row of the cost table of a route matching a shipment (parcel constraints on its lines, order constraints on the
 * order). Constraints that can not be evaluated (missing weight...) are ignored and reported.
 */
export function selectVariant(route: DeliveryRoute, lines: LineItem[], items: Map<string, Item>, orderPrice?: number): VariantChoice {
  const legacy = (route.constraints ?? {}) as { parcel_constraints?: Constraint[]; order_constraints?: Constraint[] };
  const rows: RouteVariant[] = route.variants?.length
    ? route.variants
    : [{ id: route.id, metric_values: route.metric_values, parcel_constraints: legacy.parcel_constraints ?? [], order_constraints: legacy.order_constraints ?? [] }];
  let best: { row: RouteVariant; unknown: string[] } | undefined;
  const observed = new Map<string, string>();
  for (const row of rows) {
    const unknown: string[] = [];
    let ok = true;
    const check = (c: Constraint, value: number | undefined, label: string) => {
      if (c.value === undefined || !c.op) return;
      if (value === undefined) return unknown.push(describeConstraint(c));
      observed.set(label, `${label} = ${Math.round(value * 100) / 100}`);
      if (!compare(c.op, value, c.value)) ok = false;
    };
    for (const c of row.parcel_constraints) if (c.formula) check(c, parcelValue(c.formula, lines, items), c.formula);
    for (const c of row.order_constraints) if (c.name) check(c, orderValue(c.name, lines, items, orderPrice), c.name);
    if (ok && (!best || unknown.length < best.unknown.length)) best = { row, unknown };
  }
  if (!best) return { unknown: [], failure: [...observed.values()].join(', ') || '—' };
  const conds = [...best.row.parcel_constraints, ...best.row.order_constraints].map(describeConstraint);
  return { variant: best.row, conditions: conds.join(', ') || undefined, unknown: best.unknown };
}

/** Kept for compatibility: description of the failure when no cost table row matches. */
export function constraintFailure(route: DeliveryRoute, lines: LineItem[], items: Map<string, Item>, orderPrice?: number): string | undefined {
  return selectVariant(route, lines, items, orderPrice).failure;
}

const AVAILABLE = new Set(['on_hand', 'available', 'physical', 'stock', '']);

/** Stock lines indexed by location / item (built once per stock list). */
const stockIndexes = new WeakMap<StockLine[], Map<string, StockLine[]>>();
function stockLinesOf(stock: StockLine[], endpoint: string, item: string): StockLine[] {
  let index = stockIndexes.get(stock);
  if (!index) {
    index = new Map();
    for (const s of stock) {
      const k = `${s.endpoint_id}\u0000${s.item_id}`;
      const list = index.get(k);
      if (list) list.push(s);
      else index.set(k, [s]);
    }
    stockIndexes.set(stock, index);
  }
  return index.get(`${endpoint}\u0000${item}`) ?? [];
}

function stockOf(stock: StockLine[], endpoint: string, item: string): number {
  let n = 0;
  for (const s of stockLinesOf(stock, endpoint, item)) if (s.eta_end === undefined && AVAILABLE.has(s.type ?? '')) n += s.quantity;
  return n;
}

export interface CapacityQuery {
  kind: 'preparation' | 'carrier';
  endpoint: string;
  carrier?: string;
  at: number;
  timezone?: string;
  /** Lines (preparation) or parcels (carrier) to fit in the day. */
  needed: number;
}
/** remaining: capacity left that day (Infinity = unlimited); until: end of that day (start of the next one). */
export type CapacityLookup = (q: CapacityQuery) => { remaining: number; until: number; capacity?: number } | undefined;

/** A preparation or a pickup postponed because the capacity of the day is reached. */
export interface CapacityDelay {
  kind: 'preparation' | 'carrier';
  endpoint: string;
  carrier?: string;
  /** Day (start) whose capacity is reached. */
  day: number;
  remaining: number;
  needed: number;
  /** Transfer to the consolidation point. */
  transfer?: boolean;
}

/** Days looked ahead for a day with capacity left. */
export const MAX_CAPACITY_DAYS = 90;

/** Stock request of a delivery method (GET /stock_export request_name). */
export const DEFAULT_STOCK_REQUEST = 'detailed';
export function stockRequestOf(config: DeliveryConfig | undefined): string {
  return (typeof config?.stock_request === 'string' && config.stock_request) || DEFAULT_STOCK_REQUEST;
}

/** Future stock line used to serve a line (ASN, purchase order...). */
export interface FutureStockUse {
  item_id: string;
  endpoint_id: string;
  quantity: number;
  type?: string;
  eta_start: number;
  eta_end: number;
  purchase_order_number?: string;
}

/**
 * Availability of a quantity in a stock location: on hand stock first, then the future stock lines by arrival date.
 * start / end: the quantity is there at the earliest at start, at the latest at end (0 = on hand).
 */
export function availability(
  stock: StockLine[],
  endpoint: string,
  item: string,
  qty: number,
): { quantity: number; start: number; end: number; future: FutureStockUse[] } | undefined {
  let acc = stockOf(stock, endpoint, item);
  if (acc >= qty) return { quantity: acc, start: 0, end: 0, future: [] };
  const incoming = stockLinesOf(stock, endpoint, item)
    .filter((s) => s.eta_end !== undefined && s.quantity > 0)
    .sort((a, b) => a.eta_end! - b.eta_end! || (a.eta_start ?? 0) - (b.eta_start ?? 0));
  const future: FutureStockUse[] = [];
  for (const f of incoming) {
    acc += f.quantity;
    future.push({ item_id: item, endpoint_id: endpoint, quantity: f.quantity, type: f.type, eta_start: f.eta_start ?? f.eta_end!, eta_end: f.eta_end!, purchase_order_number: f.purchase_order_number });
    if (acc >= qty) return { quantity: acc, start: Math.max(...future.map((x) => x.eta_start)), end: Math.max(...future.map((x) => x.eta_end)), future };
  }
  return undefined;
}

/** Value of a priority criterion for an analysed schema: real ETA (timetables) for time criteria, metrics otherwise. */
export function analysisValue(a: SchemaAnalysis, field: string): number | undefined {
  if (criterionKind(field) === 'time') return /start/i.test(field) ? a.eta_start : a.eta_end;
  if (/carbon|co2|footprint/i.test(field)) return a.carbon ?? criterionValue(a.schema, field);
  if (/cost|price|fee/i.test(field)) return a.cost ?? criterionValue(a.schema, field);
  return criterionValue(a.schema, field);
}

/** First criterion of the priorities on which two analysed schemas differ. */
export function decisiveBetween(order: SortOrder, selected: SchemaAnalysis, other: SchemaAnalysis) {
  const criteria = order.sort_criterias ?? [];
  for (let i = 0; i < criteria.length; i++) {
    const { field, desc = false } = criteria[i];
    const a = analysisValue(selected, field);
    const b = analysisValue(other, field);
    if (a === undefined || b === undefined || a === b) continue;
    return { rank: i + 1, field, desc, chosen: a, other: b, chosenBetter: desc ? a > b : a < b };
  }
  return undefined;
}

/** Key of a schema as displayed: carrier / option / departure zone / arrival zone of each leg. */
export function schemaKey(schema: LogisticSchema): string {
  return schema.legs.map((l) => `${l.route.carrier.name}|${l.route.carrier.option}|${l.route.origin_zone_id ?? ''}|${l.route.destination_zone_id ?? ''}`).join('>');
}

/**
 * Identical schemas (same carriers and zones, leg by leg) are shown once: within a zone, the orchestrator chooses the
 * shipping location. On a list sorted by priorities, keeps the first one able to serve every line (no exclusion),
 * else the first one.
 */
function dedupeSchemas() {
  let best: Map<string, SchemaAnalysis> | undefined;
  return (a: SchemaAnalysis, _i: number, all: SchemaAnalysis[]) => {
    if (!best) {
      best = new Map();
      for (const x of all) {
        const k = schemaKey(x.schema);
        const cur = best.get(k);
        if (!cur || (cur.exclusions.length > 0 && x.exclusions.length === 0)) best.set(k, x);
      }
    }
    return best.get(schemaKey(a.schema)) === a;
  };
}

/** Comparator implementing the priorities. */
function byPriorities(order: SortOrder) {
  return (a: SchemaAnalysis, b: SchemaAnalysis) => {
    for (const c of order.sort_criterias ?? []) {
      const va = analysisValue(a, c.field);
      const vb = analysisValue(b, c.field);
      if (va === undefined || vb === undefined || va === vb) continue;
      return c.desc ? vb - va : va - vb;
    }
    return a.schema.legs.length - b.schema.legs.length;
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

  // Stock read with the stock request of the delivery method (delivery_configs.stock_request).
  const methodStock = input.stocks && stockRequestOf(config) in input.stocks ? input.stocks[stockRequestOf(config)] : input.stock;
  const stockUnverified = methodStock === null;
  const orderPrice = orderPriceOf(lines, items, input.price);
  const stock = methodStock ?? [];
  const order = prioritiesFor(config, input.sortOrders, input.salesChannel, settingsPriorities(input.settings, method)).order;
  // Only the restrictions applied by this delivery method (delivery_configs.applied_restrictions).
  const applied = input.restrictions.filter((r) => config.applied_restrictions?.includes(r.id));
  const maxShipments = config.authorized_shipment_number ?? 4;
  const opsHours = operationsHours(config);

  // 1-2. candidate schemas, sorted by priorities
  const schemas = buildSchemas(config, destination, input.routes, ctx, { maxLegs: 3, limit: 50 });
  const timing = { timetables: input.timetables ?? new Map<string, Timetable>(), events: input.events ?? [], executionTimes: input.executionTimes ?? new Map<string, ExecutionTime>() };
  // Operations "always_at_start", executed at the order creation on their execution timetable.
  const atStart = runOperations('always_at_start', config, undefined, from, timing);
  const started = atStart?.end ?? from;
  const destEndpoint = destination.endpoint_id ? ctx.endpoints.get(destination.endpoint_id) : undefined;

  /** Moment the lines are all in a stock location (on hand or future stock): earliest (fast) / latest (slow). */
  type ShipTiming = {
    endpoint?: string;
    prep: OperationTiming[];
    fast: LegTiming[];
    slow: LegTiming[];
    endFast: number;
    endSlow: number;
    after: OperationTiming[];
    future: FutureStockUse[];
    delays: CapacityDelay[];
  };
  /**
   * Preparation then carrier legs from a moment, postponed to the next day while the preparation capacity of the stock
   * location (order lines) or the loading capacity of the first carrier there (parcels) is reached that day.
   */
  const capacityTimed = (
    routes: DeliveryRoute[],
    ep: Endpoint | undefined,
    nLines: number,
    start: number,
    track: 'min' | 'max',
    delays: CapacityDelay[],
    opts: { prepare?: boolean; transfer?: boolean; noCapacity?: boolean } = {},
  ) => {
    const cap = opts.noCapacity ? undefined : input.capacity;
    const tz = ep?.timezone;
    const transfer = opts.transfer || undefined;
    let t = start;
    // day after day until a day with capacity left (bounded to avoid looping on a calendar always full)
    for (let day = 0; day < MAX_CAPACITY_DAYS; day++) {
      const prep = opts.prepare === false ? { end: t, steps: [] as OperationTiming[] } : runOperations('before_shipping', config, ep, t, timing);
      if (!prep) return undefined;
      const pc = cap && ep ? cap({ kind: 'preparation', endpoint: ep.id, at: prep.end, timezone: tz, needed: nLines }) : undefined;
      if (pc && pc.remaining < nLines && pc.until > t) {
        delays.push({ kind: 'preparation', endpoint: ep!.id, day: pc.until - 86400, remaining: Math.max(0, pc.remaining), needed: nLines, transfer });
        t = pc.until;
        continue;
      }
      let legStart = prep.end;
      for (let d = 0; d < MAX_CAPACITY_DAYS; d++) {
        const legs = timeLegs(routes, legStart, track, timing);
        if (!legs) return undefined;
        const carrier = routes[0]?.carrier.name;
        const pickupAt = legs[0]?.pickup?.end ?? legs[0]?.departure;
        const cc = cap && ep && carrier && pickupAt !== undefined ? cap({ kind: 'carrier', endpoint: ep.id, carrier, at: pickupAt, timezone: tz, needed: 1 }) : undefined;
        if (cc && cc.remaining < 1 && cc.until > legStart) {
          delays.push({ kind: 'carrier', endpoint: ep!.id, carrier, day: cc.until - 86400, remaining: Math.max(0, cc.remaining), needed: 1, transfer });
          legStart = cc.until;
          continue;
        }
        return { prep, legs };
      }
      return undefined;
    }
    return undefined;
  };
  const readyAt = (endpoint: string | undefined, ls: LineItem[]) => {
    let fast = started;
    let slow = started;
    const future: FutureStockUse[] = [];
    if (endpoint && !stockUnverified)
      for (const l of ls) {
        const av = availability(stock, endpoint, l.item_id, l.qty);
        if (!av) continue;
        fast = Math.max(fast, av.start);
        slow = Math.max(slow, av.end);
        future.push(...av.future);
      }
    return { fast, slow, future };
  };
  /** Timing of a shipment from a stock location: preparation once the stock is there, carrier timetables, receiving. */
  const timeFrom = (routes: DeliveryRoute[], endpoint: string | undefined, ls: LineItem[], noCapacity = false): ShipTiming | undefined => {
    const ep = endpoint ? ctx.endpoints.get(endpoint) : undefined;
    const ready = readyAt(endpoint, ls);
    const nLines = ls.length || lines.length;
    const delays: CapacityDelay[] = [];
    const f = capacityTimed(routes, ep, nLines, ready.fast, 'min', [], { noCapacity });
    const sl = capacityTimed(routes, ep, nLines, ready.slow, 'max', delays, { noCapacity });
    if (!f || !sl) return undefined;
    const prepSlow = sl.prep;
    const fast = f.legs;
    const slow = sl.legs;
    const afterFast = runOperations('after_shipping', config, destEndpoint, fast[fast.length - 1].delivered, timing);
    const afterSlow = runOperations('after_shipping', config, destEndpoint, slow[slow.length - 1].delivered, timing);
    if (!afterFast || !afterSlow) return undefined;
    return { endpoint, prep: prepSlow.steps, fast, slow, endFast: afterFast.end, endSlow: afterSlow.end, after: afterSlow.steps, future: ready.future, delays };
  };

  // 3-4. exclusions and stock per schema
  const analysis: SchemaAnalysis[] = schemas.map((schema) => {
    const exclusions: SchemaAnalysis['exclusions'] = [];
    const originEndpoints = zoneEndpoints(ctx.zones.get(schema.originZoneId ?? ''), ctx).map((e) => e.id);
    const stockLines = lines.map((l) => ({
      item_id: l.item_id,
      qty: l.qty,
      endpoints: stockUnverified
        ? originEndpoints.map((id) => ({ id, quantity: NaN }))
        : originEndpoints.flatMap((id) => {
            const av = availability(stock, id, l.item_id, l.qty);
            return av ? [{ id, quantity: av.quantity, available_from: av.start || undefined, available_to: av.end || undefined }] : [];
          }),
    }));
    for (const l of lines) {
      for (const leg of schema.legs) {
        for (const r of restrictionsForRoute(leg.route, applied)) {
          if (restrictionMatchesItem(r, items.get(l.item_id)) === true)
            exclusions.push({ kind: 'restriction', item_id: l.item_id, text: `${leg.route.carrier.name} · ${leg.route.carrier.option} : ${r.description ?? r.id}` });
        }
        const failure = constraintFailure(leg.route, [l], items, orderPrice);
        if (failure) exclusions.push({ kind: 'constraint', item_id: l.item_id, text: `${leg.route.carrier.name} · ${leg.route.carrier.option} : ${failure}` });
      }
      if (!stockUnverified && !stockLines.find((s) => s.item_id === l.item_id)!.endpoints.length)
        exclusions.push({ kind: 'no_stock', item_id: l.item_id, text: '' });
    }
    // Cost table row of each leg for the whole order (single shipment assumption), else for each line alone.
    const costs = schema.legs.map((leg) => {
      let choice = selectVariant(leg.route, lines, items, orderPrice);
      if (!choice.variant) choice = selectVariant(leg.route, [lines[0]], items, orderPrice);
      const mv = choice.variant?.metric_values ?? leg.route.metric_values ?? {};
      return {
        route_id: leg.route.id,
        variant_id: choice.variant?.id,
        conditions: choice.conditions,
        cost: mv.cost_by_parcel ?? mv.cost,
        carbon: mv.carbon_footprint,
        shipping_fees: mv.shipping_fees,
        unknown: choice.unknown,
      };
    });

    // 6. timing: preparation at the origin (before_shipping), carrier timetables (pickup cutoff, transit days,
    //    delivery slots), receiving in the collection store (after_shipping).
    const routes = schema.legs.map((l) => l.route);
    const withStock = originEndpoints.filter((id) => stockUnverified || stockLines.every((sl) => sl.endpoints.some((e) => e.id === id)));
    const candidates = (withStock.length ? withStock : originEndpoints).slice(0, 25);
    // Best stock location: timings without capacities first (a capacity can only postpone), then the capacities of
    // the locations in that order, stopping as soon as the next one cannot do better: few capacity calls.
    const raw = (candidates.length ? candidates : [undefined])
      .map((id) => timeFrom(routes, id, lines, true))
      .filter((x): x is ShipTiming => !!x)
      .sort((x, y) => x.endSlow - y.endSlow);
    let best: ShipTiming | undefined;
    for (const r of raw) {
      if (best && r.endSlow >= best.endSlow) break;
      const t = input.capacity ? timeFrom(routes, r.endpoint, lines) : r;
      if (t && (!best || t.endSlow < best.endSlow)) best = t;
    }
    if (!best || !atStart)
      for (const l of lines) exclusions.push({ kind: 'timetable', item_id: l.item_id, text: routes.map((r) => `${r.carrier.name} · ${r.carrier.option}`).join(' → ') });
    const firstPickup = best?.fast[0]?.pickup;
    // Order before: carrier cutoff minus the working duration of the operations to perform before the pickup.
    const opsBefore = [...(atStart?.steps ?? []), ...(best?.prep ?? [])].reduce((h, st) => h + st.hours, 0);
    const cutoff = best && firstPickup ? firstPickup.end - Math.round(opsBefore * 3600) : undefined;
    return {
      schema,
      shipment: -1,
      shipments: [],
      stock: stockLines,
      exclusions,
      eta_start: best ? best.endFast : from + Math.round((opsHours + schema.minHours) * 3600),
      eta_end: best ? best.endSlow : from + Math.round((opsHours + schema.maxHours) * 3600),
      cutoff,
      timeline: best?.slow,
      operations: best ? [...(atStart?.steps ?? []), ...best.prep, ...best.after] : atStart?.steps,
      timing_endpoint: best?.endpoint,
      future_stock: best?.future.length ? best.future : undefined,
      capacity_delays: best?.delays.length ? best.delays : undefined,
      costs,
      cost: costs.some((c) => c.cost !== undefined) ? costs.reduce((sum, c) => sum + (c.cost ?? 0), 0) : schemaCost(schema),
      carbon: costs.some((c) => c.carbon !== undefined) ? costs.reduce((sum, c) => sum + (c.carbon ?? 0), 0) : undefined,
      shipping_fees: costs.some((c) => c.shipping_fees !== undefined) ? costs.reduce((sum, c) => sum + (c.shipping_fees ?? 0), 0) : undefined,
    };
  })
    .sort(byPriorities(order))
    // future stock (ASN, purchase orders) only when the stock on hand cannot serve: stable sort, priorities kept otherwise
    .sort((x, y) => (x.future_stock ? 1 : 0) - (y.future_stock ? 1 : 0))
    .filter(dedupeSchemas());

  const canServe = (a: SchemaAnalysis, item: string) => !a.exclusions.some((e) => e.item_id === item);

  // Click & collect served by the stock of the collection store itself (no transport).
  if (isClickAndCollect(config) && destination.endpoint_id && !stockUnverified && lines.every((l) => availability(stock, destination.endpoint_id!, l.item_id, l.qty))) {
    const there = readyAt(destination.endpoint_id, lines);
    // preparation in the collection store, within its preparation capacity (order lines): next day while full
    const ccDelays: CapacityDelay[] = [];
    let t = there.slow;
    let local = runOperations('from_destination', config, destEndpoint, t, timing);
    for (let day = 0; day < MAX_CAPACITY_DAYS && input.capacity && destEndpoint; day++) {
      const at = local?.end ?? t;
      const pc = input.capacity({ kind: 'preparation', endpoint: destEndpoint.id, at, timezone: destEndpoint.timezone, needed: lines.length });
      if (!pc || pc.remaining >= lines.length || pc.until <= t) break;
      ccDelays.push({ kind: 'preparation', endpoint: destEndpoint.id, day: pc.until - 86400, remaining: Math.max(0, pc.remaining), needed: lines.length });
      t = pc.until;
      local = runOperations('from_destination', config, destEndpoint, t, timing);
    }
    const end = local?.end ?? t;
    const h = (end - from) / 3600;
    return {
      ...base,
      config,
      analysis,
      operations_hours: h,
      local_pickup: true,
      local_operations: [...(atStart?.steps ?? []), ...(local?.steps ?? [])],
      status: 'valid',
      eta_start: end,
      eta_end: end,
      cost: 0,
      shipment_number: 1,
      delivery_routes: [],
      future_stock: there.future.length ? there.future : undefined,
      capacity_delays: ccDelays.length ? ccDelays : undefined,
    };
  }
  if (!schemas.length) return { ...base, config, analysis, operations_hours: opsHours, status: 'none', reason: 'no_eligible_route' };

  // 5. allocation: one shipment serving every line if possible, else split (best schema first) within the limit.
  type Shipment = { a: SchemaAnalysis; endpoint: string; lines: LineItem[] };
  const shipments: Shipment[] = [];
  const endpointFor = (a: SchemaAnalysis, ls: LineItem[]) => {
    const holds = (id: string) => ls.every((l) => a.stock.find((s) => s.item_id === l.item_id)?.endpoints.some((x) => x.id === id));
    if (a.timing_endpoint && holds(a.timing_endpoint)) return a.timing_endpoint;
    return a.stock.find((s) => s.item_id === ls[0].item_id)?.endpoints.find((e) => holds(e.id))?.id;
  };

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

  // 8. consolidation: one shipment from an intermediate point after transfers of the missing items
  let consolidationFailed = false;
  if (input.consolidate && (shipments.length > 1 || excluded.length > 0)) {
    const c = consolidate();
    if (c) {
      for (const a of analysis) {
        a.shipment = -1;
        a.shipments = [];
      }
      c.analysis.shipment = 0;
      c.analysis.shipments = [{ index: 0, endpoint: c.point, lines: [...lines] }];
      const finalRoutes: PromiseRoute[] = c.analysis.schema.legs.map((leg, idx) => ({
        id: leg.route.id,
        carrier: leg.route.carrier,
        origin_zone_id: leg.route.origin_zone_id,
        destination_zone_id: leg.route.destination_zone_id,
        origin_endpoint_id: idx === 0 ? c.point : undefined,
        items: lines.map((l) => ({ id: l.item_id, quantity: l.qty })),
        eta_start: c.timeline?.[idx]?.slot?.start ?? c.timeline?.[idx]?.arrival,
        eta_end: c.timeline?.[idx]?.delivered,
        metric_values: leg.route.metric_values,
      }));
      const transferRoutes: PromiseRoute[] = c.transfers.flatMap((tr) =>
        tr.schema.legs.map((leg, idx) => ({
          id: leg.route.id,
          carrier: leg.route.carrier,
          origin_zone_id: leg.route.origin_zone_id,
          destination_zone_id: leg.route.destination_zone_id,
          origin_endpoint_id: idx === 0 ? tr.from : undefined,
          items: [{ id: tr.item_id, quantity: tr.qty }],
          eta_end: tr.timeline?.[idx]?.delivered,
          metric_values: leg.route.metric_values,
          transfer: true,
        })),
      );
      return {
        ...base,
        config,
        analysis,
        operations_hours: (c.ready - from) / 3600,
        stock_unverified: stockUnverified,
        status: 'valid',
        eta_start: c.eta_start,
        eta_end: c.eta_end,
        cutoff: c.analysis.cutoff,
        cost: Math.round(c.cost * 100) / 100,
        shipping_fees: c.shipping_fees === undefined ? undefined : Math.round(c.shipping_fees * 100) / 100,
        carbon_footprint: c.carbon,
        shipment_number: 1,
        delivery_routes: [...transferRoutes, ...finalRoutes],
        consolidation: c,
        capacity_delays: c.capacity_delays?.length ? c.capacity_delays : undefined,
        future_stock: (() => {
          const f = [...readyAt(c.point, c.local).future, ...c.transfers.flatMap((tr) => readyAt(tr.from, [{ item_id: tr.item_id, qty: tr.qty }]).future)];
          return f.length ? f : undefined;
        })(),
      };
    }
    consolidationFailed = true;
  }

  /**
   * Consolidation point: a stock location of the origin zone of a final schema of the method (respecting its carriers,
   * restrictions and cost tables), able to receive the missing items through transfer routes of the same delivery
 * method (carriers / options of its configuration), then to
   * ship everything in one parcel. The best candidate according to the priorities of the method is returned.
   */
  function consolidate(): Consolidation | undefined {
    const transferChains = new Map<string, LogisticSchema[]>();
    const chainsTo = (endpoint: string) => {
      if (!transferChains.has(endpoint))
        transferChains.set(endpoint, buildSchemas({ ...config!, delivery_zone_ids: undefined }, { endpoint_id: endpoint }, input.routes, ctx, { maxLegs: 2, limit: 30 }));
      return transferChains.get(endpoint)!;
    };
    const candidates: Consolidation[] = [];
    for (const a of analysis) {
      // final schema: every line allowed (restrictions, cost tables); missing stock is solved by the transfers
      if (a.exclusions.some((e) => e.kind !== 'no_stock')) continue;
      const finalCosts = a.schema.legs.map((leg) => selectVariant(leg.route, lines, items, orderPrice));
      if (finalCosts.some((v) => !v.variant)) continue; // the grouped parcel must match a cost table row
      for (const point of zoneEndpoints(ctx.zones.get(a.schema.originZoneId ?? ''), ctx).slice(0, 25)) {
        const pointEp = ctx.endpoints.get(point.id);
        const local: LineItem[] = [];
        const transfers: ConsolidationTransfer[] = [];
        let ok = true;
        for (const l of lines) {
          if (!stockUnverified && availability(stock, point.id, l.item_id, l.qty)) {
            local.push(l);
            continue;
          }
          if (stockUnverified) {
            local.push(l);
            continue;
          }
          let best: ConsolidationTransfer | undefined;
          // candidate origins timed without capacities, then with them in that order until none can arrive earlier
          const raw: { chain: LogisticSchema; routes: DeliveryRoute[]; from: string; arrival: number }[] = [];
          for (const chain of chainsTo(point.id)) {
            const chainRoutes = chain.legs.map((x) => x.route);
            if (chainRoutes.some((r) => !selectVariant(r, [l], items, orderPrice).variant)) continue;
            for (const from of zoneEndpoints(ctx.zones.get(chain.originZoneId ?? ''), ctx).slice(0, 25)) {
              if (from.id === point.id || !availability(stock, from.id, l.item_id, l.qty)) continue;
              const timed = capacityTimed(chainRoutes, ctx.endpoints.get(from.id), 1, readyAt(from.id, [l]).slow, 'max', [], { transfer: true, noCapacity: true });
              if (timed) raw.push({ chain, routes: chainRoutes, from: from.id, arrival: timed.legs[timed.legs.length - 1].delivered });
            }
          }
          raw.sort((x, y) => x.arrival - y.arrival);
          for (const c of raw) {
            if (best && c.arrival >= best.arrival) break;
            // preparation and pickup at the origin of the transfer, within the capacities of the day
            const trDelays: CapacityDelay[] = [];
            const timed = capacityTimed(c.routes, ctx.endpoints.get(c.from), 1, readyAt(c.from, [l]).slow, 'max', trDelays, { transfer: true });
            if (!timed) continue;
            const legs = timed.legs;
            const arrival = legs[legs.length - 1].delivered;
            if (!best || arrival < best.arrival) {
              const tmvs = c.routes.map((r) => selectVariant(r, [l], items, orderPrice).variant?.metric_values ?? r.metric_values ?? {});
              const cost = tmvs.reduce((sum, mv) => sum + (mv.cost_by_parcel ?? mv.cost ?? 0), 0);
              const carbon = tmvs.some((mv) => mv.carbon_footprint !== undefined) ? tmvs.reduce((sum, mv) => sum + (mv.carbon_footprint ?? 0), 0) : undefined;
              best = { item_id: l.item_id, qty: l.qty, from: c.from, schema: c.chain, timeline: legs, arrival, cost, carbon, capacity_delays: trDelays };
            }
          }
          if (!best) {
            ok = false;
            break;
          }
          transfers.push(best);
        }
        if (!ok) continue;
        const prepLocal = runOperations('before_shipping', config!, pointEp, readyAt(point.id, local).slow, timing);
        if (!prepLocal) continue;
        const ready = Math.max(prepLocal.end, ...transfers.map((tr) => tr.arrival));
        const routes = a.schema.legs.map((x) => x.route);
        // the grouped parcel (every line) within the preparation capacity of the point and its carrier capacity
        const finalDelays: CapacityDelay[] = [];
        const fastT = capacityTimed(routes, pointEp, lines.length, ready, 'min', [], { prepare: false });
        const slowT = capacityTimed(routes, pointEp, lines.length, ready, 'max', finalDelays, { prepare: false });
        if (!fastT || !slowT) continue;
        const fast = fastT.legs;
        const slow = slowT.legs;
        const afterFast = runOperations('after_shipping', config!, destEndpoint, fast[fast.length - 1].delivered, timing);
        const afterSlow = runOperations('after_shipping', config!, destEndpoint, slow[slow.length - 1].delivered, timing);
        if (!afterFast || !afterSlow) continue;
        const mvs = finalCosts.map((v, i) => v.variant?.metric_values ?? a.schema.legs[i].route.metric_values ?? {});
        const finalCost = mvs.reduce((sum, mv) => sum + (mv.cost_by_parcel ?? mv.cost ?? 0), 0);
        const carbonParts = [...mvs.map((mv) => mv.carbon_footprint), ...transfers.map((tr) => tr.carbon)];
        const carbon = carbonParts.some((v) => v !== undefined) ? carbonParts.reduce<number>((sum, v) => sum + (v ?? 0), 0) : undefined;
        const fees = mvs.some((mv) => mv.shipping_fees !== undefined) ? mvs.reduce((sum, mv) => sum + (mv.shipping_fees ?? 0), 0) : undefined;
        candidates.push({
          point: point.id,
          analysis: a,
          local,
          transfers,
          ready,
          timeline: slow,
          eta_start: afterFast.end,
          eta_end: afterSlow.end,
          cost: finalCost + transfers.reduce((sum, tr) => sum + (tr.cost ?? 0), 0),
          carbon,
          capacity_delays: [...transfers.flatMap((tr) => tr.capacity_delays ?? []), ...finalDelays],
          shipping_fees: fees,
        });
      }
    }
    // best candidate according to the priorities of the method (time: eta_end, cost: total cost)
    const value = (c: Consolidation, field: string) =>
      criterionKind(field) === 'time' ? (/start/i.test(field) ? c.eta_start : c.eta_end) : /cost|price|fee/i.test(field) ? c.cost : analysisValue(c.analysis, field);
    candidates.sort((x, y) => {
      for (const cr of order.sort_criterias ?? []) {
        const vx = value(x, cr.field);
        const vy = value(y, cr.field);
        if (vx === undefined || vy === undefined || vx === vy) continue;
        return cr.desc ? vy - vx : vx - vy;
      }
      return x.transfers.length - y.transfers.length || x.eta_end - y.eta_end;
    });
    return candidates[0];
  }

  // 7. routes, dates, cost: timing of each shipment from its own stock location (on hand or future stock)
  const times = shipments.map((s) => {
    const own = s.endpoint === s.a.timing_endpoint && s.lines.length === lines.length;
    const t = own ? undefined : timeFrom(s.a.schema.legs.map((l) => l.route), s.endpoint, s.lines);
    if (!t) return { eta_start: s.a.eta_start, eta_end: s.a.eta_end, cutoff: s.a.cutoff, timeline: s.a.timeline, future: s.a.future_stock ?? [], delays: s.a.capacity_delays ?? [] };
    const pickup = t.fast[0]?.pickup;
    const opsBefore = [...(atStart?.steps ?? []), ...t.prep].reduce((h, st) => h + st.hours, 0);
    return { eta_start: t.endFast, eta_end: t.endSlow, cutoff: pickup ? pickup.end - Math.round(opsBefore * 3600) : undefined, timeline: t.slow, future: t.future, delays: t.delays };
  });
  const deliveryRoutes: PromiseRoute[] = shipments.flatMap((s, si) =>
    s.a.schema.legs.map((leg, idx) => {
      const tl = times[si].timeline?.[idx];
      return {
        id: leg.route.id,
        carrier: leg.route.carrier,
        origin_zone_id: leg.route.origin_zone_id,
        destination_zone_id: leg.route.destination_zone_id,
        origin_endpoint_id: idx === 0 ? s.endpoint : undefined,
        items: s.lines.map((l) => ({ id: l.item_id, quantity: l.qty })),
        eta_start: tl?.slot?.start ?? tl?.arrival,
        eta_end: tl?.delivered,
        metric_values: leg.route.metric_values,
      };
    }),
  );
  const cutoffs = times.map((x) => x.cutoff).filter((c): c is number => c !== undefined);
  const futureStock = times.flatMap((x) => x.future);
  const capacityDelays = times.flatMap((x) => x.delays);
  const cost = shipments.reduce((sum, s) => sum + (s.a.cost ?? 0), 0);
  const fees = shipments.some((s) => s.a.shipping_fees !== undefined) ? shipments.reduce((sum, s) => sum + (s.a.shipping_fees ?? 0), 0) : undefined;
  const carbon = shipments.reduce((sum, s) => sum + (s.a.carbon ?? criterionValue(s.a.schema, 'carbon_footprint') ?? 0), 0);

  return {
    ...base,
    config,
    analysis,
    operations_hours: shipments[0]?.a.timeline?.[0] ? (shipments[0].a.timeline[0].ready - from) / 3600 : opsHours,
    stock_unverified: stockUnverified,
    status: excluded.length ? 'partial' : 'valid',
    eta_start: Math.max(...times.map((x) => x.eta_start)),
    eta_end: Math.max(...times.map((x) => x.eta_end)),
    future_stock: futureStock.length ? futureStock : undefined,
    capacity_delays: capacityDelays.length ? capacityDelays : undefined,
    cutoff: cutoffs.length ? Math.min(...cutoffs) : undefined,
    cost: Math.round(cost * 100) / 100,
    shipping_fees: fees === undefined ? undefined : Math.round(fees * 100) / 100,
    carbon_footprint: carbon || undefined,
    shipment_number: shipments.length,
    line_items: excluded.length ? served : undefined,
    excluded_line_items: excluded.length ? excluded : undefined,
    delivery_routes: deliveryRoutes,
    consolidation_failed: consolidationFailed || undefined,
  };
}

