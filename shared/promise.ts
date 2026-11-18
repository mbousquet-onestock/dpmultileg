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
import type { Constraint, DeliveryConfig, DeliveryRestriction, DeliveryRoute, Destination, Item, LineItem, PromiseOption, PromiseRoute, RouteVariant, SortOrder } from './types.js';

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
  /** Carrier timetables (GET /timetables) by id, and scheduled events (GET /scheduledevents). */
  timetables?: Map<string, Timetable>;
  events?: ScheduledEvent[];
  /** Execution times of the operations (GET /execution_times) by id. */
  executionTimes?: Map<string, ExecutionTime>;
  /** Extension settings (priorities per delivery method). */
  settings?: Record<string, unknown>;
}

export type ExclusionKind = 'restriction' | 'constraint' | 'no_stock' | 'timetable';

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
  cost?: number;
}

export interface LocalPromiseOption extends PromiseOption {
  config?: DeliveryConfig;
  analysis: SchemaAnalysis[];
  /** Operations hours added to the transit. */
  operations_hours: number;
  /** Served by the stock of the collection store, without transport. */
  local_pickup?: boolean;
  /** Operations timed for a local pickup (at start + from destination). */
  local_operations?: OperationTiming[];
  /** The stock could not be read: availability not verified. */
  stock_unverified?: boolean;
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
    const values = attr(item, name);
    if (!values) continue;
    for (const cond of Object.values(conds ?? {})) {
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

function stockOf(stock: StockLine[], endpoint: string, item: string): number {
  return stock.filter((s) => s.endpoint_id === endpoint && s.item_id === item && AVAILABLE.has(s.type ?? '')).reduce((n, s) => n + s.quantity, 0);
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

  const stockUnverified = input.stock === null;
  const orderPrice = orderPriceOf(lines, items, input.price);
  const stock = input.stock ?? [];
  const order = prioritiesFor(config, input.sortOrders, input.salesChannel, settingsPriorities(input.settings, method)).order;
  const applied = config.applied_restrictions?.length ? input.restrictions.filter((r) => config.applied_restrictions!.includes(r.id)) : input.restrictions;
  const maxShipments = config.authorized_shipment_number ?? 4;
  const opsHours = operationsHours(config);

  // 1-2. candidate schemas, sorted by priorities
  const schemas = buildSchemas(config, destination, input.routes, ctx, { maxLegs: 3, limit: 50 });
  const timing = { timetables: input.timetables ?? new Map<string, Timetable>(), events: input.events ?? [], executionTimes: input.executionTimes ?? new Map<string, ExecutionTime>() };
  // Operations "always_at_start", executed at the order creation on their execution timetable.
  const atStart = runOperations('always_at_start', config, undefined, from, timing);
  const started = atStart?.end ?? from;
  const destEndpoint = destination.endpoint_id ? ctx.endpoints.get(destination.endpoint_id) : undefined;

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
    let best: { endpoint?: string; prep: OperationTiming[]; fast: LegTiming[]; slow: LegTiming[]; endFast: number; endSlow: number; after: OperationTiming[] } | undefined;
    for (const id of candidates.length ? candidates : [undefined]) {
      const ep = id ? ctx.endpoints.get(id) : undefined;
      const prep = runOperations('before_shipping', config, ep, started, timing);
      if (!prep) continue;
      const fast = timeLegs(routes, prep.end, 'min', timing);
      const slow = timeLegs(routes, prep.end, 'max', timing);
      if (!fast || !slow) continue;
      const afterFast = runOperations('after_shipping', config, destEndpoint, fast[fast.length - 1].delivered, timing);
      const afterSlow = runOperations('after_shipping', config, destEndpoint, slow[slow.length - 1].delivered, timing);
      if (!afterFast || !afterSlow) continue;
      if (!best || afterSlow.end < best.endSlow)
        best = { endpoint: id, prep: prep.steps, fast, slow, endFast: afterFast.end, endSlow: afterSlow.end, after: afterSlow.steps };
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
      costs,
      cost: costs.some((c) => c.cost !== undefined) ? costs.reduce((sum, c) => sum + (c.cost ?? 0), 0) : schemaCost(schema),
      carbon: costs.some((c) => c.carbon !== undefined) ? costs.reduce((sum, c) => sum + (c.carbon ?? 0), 0) : undefined,
    };
  }).sort(byPriorities(order));

  const canServe = (a: SchemaAnalysis, item: string) => !a.exclusions.some((e) => e.item_id === item);

  // Click & collect served by the stock of the collection store itself (no transport).
  if (isClickAndCollect(config) && destination.endpoint_id && !stockUnverified && lines.every((l) => stockOf(stock, destination.endpoint_id!, l.item_id) >= l.qty)) {
    const local = runOperations('from_destination', config, destEndpoint, started, timing);
    const end = local?.end ?? started;
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

  // 7. routes, dates, cost
  const deliveryRoutes: PromiseRoute[] = shipments.flatMap((s) =>
    s.a.schema.legs.map((leg, idx) => {
      const tl = s.a.timeline?.[idx];
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
  const cutoffs = shipments.map((s) => s.a.cutoff).filter((c): c is number => c !== undefined);
  const cost = shipments.reduce((sum, s) => sum + (s.a.cost ?? 0), 0);
  const carbon = shipments.reduce((sum, s) => sum + (s.a.carbon ?? criterionValue(s.a.schema, 'carbon_footprint') ?? 0), 0);

  return {
    ...base,
    config,
    analysis,
    operations_hours: shipments[0]?.a.timeline?.[0] ? (shipments[0].a.timeline[0].ready - from) / 3600 : opsHours,
    stock_unverified: stockUnverified,
    status: excluded.length ? 'partial' : 'valid',
    eta_start: Math.max(...shipments.map((s) => s.a.eta_start)),
    eta_end: Math.max(...shipments.map((s) => s.a.eta_end)),
    cutoff: cutoffs.length ? Math.min(...cutoffs) : undefined,
    cost: Math.round(cost * 100) / 100,
    carbon_footprint: carbon || undefined,
    shipment_number: shipments.length,
    line_items: excluded.length ? served : undefined,
    excluded_line_items: excluded.length ? excluded : undefined,
    delivery_routes: deliveryRoutes,
  };
}

