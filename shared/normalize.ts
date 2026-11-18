/**
 * The internal GET routes are not formally documented: depending on the version they answer
 * `{ delivery_routes: [...] }`, `{ delivery_routes: { id: {...} } }` or a raw array.
 * These helpers turn any of these shapes into a list of documents with an `id`.
 */
export function asList<T extends { id: string }>(payload: unknown, ...keys: string[]): T[] {
  let value: unknown = payload;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const key = keys.find((k) => k in obj);
    if (key) value = obj[key];
  }
  if (Array.isArray(value)) return value.map((v) => withId(v)).filter(Boolean) as T[];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([id, v]) => withId(v, id))
      .filter(Boolean) as T[];
  }
  return [];
}

function withId(v: unknown, fallbackId?: string): { id: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = (o.id ?? o._id ?? fallbackId) as string | undefined;
  if (!id) return null;
  return { ...o, id: String(id) };
}

export function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

import type { Constraint, DeliveryRoute, RouteVariant } from './types.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Delivery routes from GET /delivery_routes. Two shapes are supported:
 *  - grouped (current API): { public_id, carrier_name, carrier_option, origin_zone_id, destination_zone_id,
 *    *_timetable_id, minimum/maximum_transit_hours, routes: [{ routes: [row...], order_constraints }] }
 *    where each row is a line of the cost table (constraints + metric_values);
 *  - flat: { id, carrier: { name, option }, ... }.
 * Each group becomes one logical route whose `variants` are the cost table rows.
 */
export function normalizeRoutes(payload: unknown): DeliveryRoute[] {
  let list: unknown[] = [];
  if (Array.isArray(payload)) list = payload;
  else if (isObj(payload)) {
    const key = ['delivery_routes', 'routes', 'data'].find((k) => Array.isArray(payload[k]) || isObj(payload[k]));
    if (key && (payload.public_id === undefined || key !== 'routes')) {
      const v = payload[key];
      list = Array.isArray(v) ? v : Object.entries(v as Obj).map(([id, x]) => (isObj(x) ? { id, ...x } : x));
    } else list = [payload];
  }
  return list.filter(isObj).map(toRoute).filter((r): r is DeliveryRoute => !!r);
}

function toRoute(o: Obj): DeliveryRoute | undefined {
  const groups = Array.isArray(o.routes) ? (o.routes as unknown[]).filter(isObj) : [];
  const rows: Obj[] = groups.flatMap((g) => {
    const inner = Array.isArray(g.routes) ? (g.routes as unknown[]).filter(isObj) : [g];
    const groupOrder = Array.isArray(g.order_constraints) ? (g.order_constraints as Constraint[]) : [];
    return inner.map((r) => ({ ...r, __group_order: groupOrder }));
  });
  const first = rows[0] ?? o;
  const carrierObj = (isObj(o.carrier) ? o.carrier : isObj(first.carrier) ? first.carrier : {}) as Obj;
  const name = (o.carrier_name ?? carrierObj.name) as string | undefined;
  const option = (o.carrier_option ?? carrierObj.option) as string | undefined;
  const id = String(o.public_id ?? o.id ?? o._id ?? first.id ?? '');
  if (!id || !name) return undefined;
  const pick = (k: string) => (o[k] ?? first[k]) as never;
  const variants: RouteVariant[] | undefined = rows.length
    ? rows.map((r) => {
        const c = (isObj(r.constraints) ? r.constraints : {}) as Obj;
        const order = [...((r.__group_order as Constraint[]) ?? []), ...((c.order_constraints as Constraint[]) ?? [])];
        // the same order constraint may be repeated on the group and on the row
        const seen = new Set<string>();
        return {
          id: String(r.id ?? r._id ?? ''),
          metric_values: r.metric_values as Record<string, number> | undefined,
          parcel_constraints: (c.parcel_constraints as Constraint[]) ?? [],
          order_constraints: order.filter((x) => {
            const k = JSON.stringify(x);
            return seen.has(k) ? false : (seen.add(k), true);
          }),
          information: r.information as Record<string, unknown> | undefined,
        };
      })
    : undefined;
  const { routes: _r, carrier_name: _n, carrier_option: _o, ...rest } = o;
  return {
    ...(rest as object),
    id,
    carrier: { name, option: option ?? '' },
    origin_zone_id: pick('origin_zone_id'),
    destination_zone_id: pick('destination_zone_id'),
    minimum_transit_hours: pick('minimum_transit_hours'),
    maximum_transit_hours: pick('maximum_transit_hours'),
    pickup_timetable_id: pick('pickup_timetable_id'),
    opening_timetable_id: pick('opening_timetable_id'),
    delivery_timetable_id: pick('delivery_timetable_id'),
    metric_values: (o.metric_values ?? first.metric_values) as Record<string, number> | undefined,
    constraints: (o.constraints ?? (variants ? undefined : first.constraints)) as unknown,
    variants,
  } as DeliveryRoute;
}
