import type {
  Carrier,
  DeliveryConfig,
  DeliveryRoute,
  Destination,
  Endpoint,
  Location,
  PromiseOption,
  PromiseRoute,
  Zone,
} from './types.js';

/* ------------------------------------------------------------------------------------------------
 * Zones
 * ---------------------------------------------------------------------------------------------- */

export interface ZoneContext {
  zones: Map<string, Zone>;
  endpoints: Map<string, Endpoint>;
}

function safeRegex(src?: string): RegExp | null {
  if (!src) return null;
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

export function endpointLocation(ep: Endpoint | undefined): Location | undefined {
  if (!ep) return undefined;
  return {
    country: ep.address?.regions?.country?.code,
    state: ep.address?.regions?.state?.code,
    zip_code: ep.address?.zip_code,
    timezone: ep.timezone,
  };
}

/**
 * Does a location (and/or an endpoint) belong to a zone?
 * Mirrors the zone definition of POST /zones:
 *  - explicit endpoint inclusion/exclusion wins,
 *  - excluded_zones / included_zones are evaluated recursively,
 *  - every criterion that is set (country_codes, regions, zip_code, excluded_zip_code, timezones) must match.
 */
export function zoneContains(
  zone: Zone | undefined,
  target: { location?: Location; endpoint_id?: string },
  ctx: ZoneContext,
  seen: Set<string> = new Set(),
): boolean {
  if (!zone || seen.has(zone.id)) return false;
  const visited = new Set(seen).add(zone.id);
  const epId = target.endpoint_id;
  const loc = target.location ?? (epId ? endpointLocation(ctx.endpoints.get(epId)) : undefined);

  if (epId && zone.excluded_endpoint_ids?.includes(epId)) return false;
  if (epId && zone.included_endpoint_ids?.includes(epId)) return true;

  if (zone.excluded_zones?.some((z) => zoneContains(ctx.zones.get(z), target, ctx, visited))) return false;
  if (zone.included_zones?.some((z) => zoneContains(ctx.zones.get(z), target, ctx, visited))) return true;

  if (!loc) return false;
  let hasCriterion = false;

  if (zone.country_codes?.length) {
    hasCriterion = true;
    if (!loc.country || !zone.country_codes.map((c) => c.toUpperCase()).includes(loc.country.toUpperCase())) return false;
  }
  if (zone.regions?.length) {
    hasCriterion = true;
    if (!loc.state || !zone.regions.map((r) => r.toUpperCase()).includes(loc.state.toUpperCase())) return false;
  }
  const zip = safeRegex(zone.zip_code);
  if (zip) {
    hasCriterion = true;
    if (!loc.zip_code || !zip.test(loc.zip_code)) return false;
  }
  const excludedZip = safeRegex(zone.excluded_zip_code);
  if (excludedZip && loc.zip_code && excludedZip.test(loc.zip_code)) return false;
  if (zone.timezones?.length) {
    hasCriterion = true;
    if (!loc.timezone || !zone.timezones.includes(loc.timezone)) return false;
  }
  return hasCriterion;
}

/** Endpoints (stock locations) belonging to a zone. */
export function zoneEndpoints(zone: Zone | undefined, ctx: ZoneContext): Endpoint[] {
  if (!zone) return [];
  const result: Endpoint[] = [];
  for (const ep of ctx.endpoints.values()) {
    if (zoneContains(zone, { endpoint_id: ep.id }, ctx)) result.push(ep);
  }
  // Endpoints explicitly included but not loaded yet.
  for (const id of zone.included_endpoint_ids ?? []) {
    if (!ctx.endpoints.has(id)) result.push({ id });
  }
  return result;
}

/** Does the destination of a delivery option belong to a zone? */
export function destinationInZone(zone: Zone | undefined, dest: Destination, ctx: ZoneContext): boolean {
  if (!zone) return false;
  if (dest.delivery_zone) {
    if (dest.delivery_zone === zone.id) return true;
    // A requested zone is "in" another zone if it is explicitly included in it.
    return !!zone.included_zones?.includes(dest.delivery_zone);
  }
  return zoneContains(zone, { location: dest.location, endpoint_id: dest.endpoint_id }, ctx);
}

/**
 * A zone made of stock locations only (warehouses, hubs, stores): goods arriving there can be shipped again.
 * Geographic zones (countries, zip codes...) describe customers and can't be an intermediate step.
 */
export function isStockZone(zone: Zone | undefined, ctx: ZoneContext, seen: Set<string> = new Set()): boolean {
  if (!zone || seen.has(zone.id)) return false;
  const geographic = !!(zone.country_codes?.length || zone.regions?.length || zone.zip_code || zone.timezones?.length);
  if (geographic) return false;
  const next = new Set(seen).add(zone.id);
  const included = zone.included_zones ?? [];
  if (included.length && !included.every((z) => isStockZone(ctx.zones.get(z), ctx, next))) return false;
  return !!(zone.included_endpoint_ids?.length || included.length);
}

/**
 * Two legs can be chained when the arrival zone of the first one is a stock zone (hub, stores...) and
 * the second leg departs from it: same zone, one includes the other, or they share at least one stock location.
 */
export function zonesConnect(arrival: string | undefined, departure: string | undefined, ctx: ZoneContext): boolean {
  if (!arrival || !departure) return false;
  const a = ctx.zones.get(arrival);
  const d = ctx.zones.get(departure);
  if (!isStockZone(a, ctx)) return false;
  if (arrival === departure) return true;
  if (!a || !d) return false;
  if (a.included_zones?.includes(departure) || d.included_zones?.includes(arrival)) return true;
  const aEps = new Set(zoneEndpoints(a, ctx).map((e) => e.id));
  if (aEps.size === 0) return false;
  return zoneEndpoints(d, ctx).some((e) => aEps.has(e.id));
}

/* ------------------------------------------------------------------------------------------------
 * Delivery configs
 * ---------------------------------------------------------------------------------------------- */

export const sameCarrier = (a?: Carrier, b?: Carrier) =>
  !!a && !!b && a.name === b.name && (a.option === b.option || !a.option || !b.option);

export function configsFor(configs: DeliveryConfig[], salesChannel?: string): DeliveryConfig[] {
  return configs.filter((c) => !salesChannel || !c.sales_channel_id || c.sales_channel_id === salesChannel);
}

/** Delivery methods available for a sales channel (deduplicated, keeps the first config of each method). */
export function deliveryMethods(configs: DeliveryConfig[], salesChannel?: string): DeliveryConfig[] {
  const seen = new Map<string, DeliveryConfig>();
  for (const c of configsFor(configs, salesChannel)) if (!seen.has(c.delivery_method)) seen.set(c.delivery_method, c);
  return [...seen.values()];
}

export function isClickAndCollect(config: DeliveryConfig | undefined): boolean {
  if (!config) return false;
  const s = `${config.type ?? ''} ${config.delivery_method} ${config.name ?? ''}`.toLowerCase();
  return /ckc|click|collect|c&c|pickup|retrait|store_delivery/.test(s);
}

/* ------------------------------------------------------------------------------------------------
 * Multi-leg schemas
 * ---------------------------------------------------------------------------------------------- */

export interface Leg {
  route: DeliveryRoute;
  /** Carrier is one of the carriers of the delivery configuration. */
  configCarrier: boolean;
}

export interface LogisticSchema {
  /** Legs from the origin (stock) to the final destination. */
  legs: Leg[];
  originZoneId?: string;
  minHours: number;
  maxHours: number;
}

export interface SchemaOptions {
  maxLegs?: number;
  /** Max number of schemas returned. */
  limit?: number;
}

/**
 * Enumerate every chain of delivery routes able to bring goods to the destination for a delivery configuration.
 *
 * - the last leg must arrive in a zone containing the destination and, when the configuration lists
 *   delivery zones, the destination must belong to one of them;
 * - when the configuration lists carriers, the last leg must use one of them (upstream legs, e.g.
 *   warehouse -> store replenishment, may use any carrier: they are flagged with configCarrier=false);
 * - legs are chained backward: the arrival zone of a leg must connect with the departure zone of the next one.
 */
export function buildSchemas(
  config: DeliveryConfig | undefined,
  destination: Destination,
  routes: DeliveryRoute[],
  ctx: ZoneContext,
  opts: SchemaOptions = {},
): LogisticSchema[] {
  const maxLegs = opts.maxLegs ?? 3;
  const limit = opts.limit ?? 30;
  const carriers = config?.carriers ?? [];
  const isConfigCarrier = (r: DeliveryRoute) => carriers.length === 0 || carriers.some((c) => sameCarrier(c, r.carrier));

  if (config?.delivery_zone_ids?.length) {
    const ok = config.delivery_zone_ids.some((z) => destinationInZone(ctx.zones.get(z), destination, ctx));
    if (!ok) return [];
  }

  const lastLegs = routes.filter((r) => isConfigCarrier(r) && destinationInZone(ctx.zones.get(r.destination_zone_id ?? ''), destination, ctx));

  const results: LogisticSchema[] = [];
  const queue: Leg[][] = lastLegs.map((r) => [{ route: r, configCarrier: true }]);
  while (queue.length) {
    const chain = queue.shift()!;
    results.push(toSchema(chain));
    if (chain.length >= maxLegs) continue;
    const first = chain[0].route;
    const usedZones = new Set(chain.flatMap((l) => [l.route.origin_zone_id, l.route.destination_zone_id]));
    for (const r of routes) {
      if (chain.some((l) => l.route.id === r.id)) continue;
      if (!zonesConnect(r.destination_zone_id, first.origin_zone_id, ctx)) continue;
      // Avoid loops (going back to a zone already crossed).
      if (r.origin_zone_id && usedZones.has(r.origin_zone_id)) continue;
      queue.push([{ route: r, configCarrier: isConfigCarrier(r) }, ...chain]);
    }
  }
  return results.sort((a, b) => a.legs.length - b.legs.length || a.maxHours - b.maxHours).slice(0, limit);
}

function toSchema(legs: Leg[]): LogisticSchema {
  return {
    legs,
    originZoneId: legs[0]?.route.origin_zone_id,
    minHours: legs.reduce((s, l) => s + (l.route.minimum_transit_hours ?? 0), 0),
    maxHours: legs.reduce((s, l) => s + (l.route.maximum_transit_hours ?? l.route.minimum_transit_hours ?? 0), 0),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Delivery promise result -> schema actually used
 * ---------------------------------------------------------------------------------------------- */

export interface Shipment {
  /** Items carried by this shipment (when returned by the API). */
  items: { id: string; quantity: number }[];
  legs: { route?: DeliveryRoute; promise: PromiseRoute }[];
  eta_start?: number;
  eta_end?: number;
}

function resolveRoute(pr: PromiseRoute, routesById: Map<string, DeliveryRoute>, routes: DeliveryRoute[]): DeliveryRoute | undefined {
  if (pr.id && routesById.has(pr.id)) return routesById.get(pr.id);
  const candidates = routes.filter((r) => sameCarrier(r.carrier, pr.carrier));
  if (pr.origin_zone_id || pr.destination_zone_id)
    return (
      candidates.find((r) => r.origin_zone_id === pr.origin_zone_id && r.destination_zone_id === pr.destination_zone_id) ?? candidates[0]
    );
  return candidates.length === 1 ? candidates[0] : undefined;
}

const itemsKey = (pr: PromiseRoute) =>
  (pr.items ?? [])
    .map((i) => `${i.id}:${i.quantity}`)
    .sort()
    .join('|');

/**
 * Group the routes returned by GET /delivery_promises (fields: delivery_options.delivery_routes) into shipments,
 * and order the legs of each shipment from origin to destination.
 * Routes carrying the same items belong to the same shipment (several legs); routes without item detail are
 * chained together using their zones.
 */
export function shipmentsFromPromise(option: PromiseOption, routes: DeliveryRoute[], ctx: ZoneContext): Shipment[] {
  const promiseRoutes = option.delivery_routes ?? [];
  if (!promiseRoutes.length) return [];
  const routesById = new Map(routes.map((r) => [r.id, r]));

  const groups = new Map<string, PromiseRoute[]>();
  for (const pr of promiseRoutes) {
    const k = itemsKey(pr);
    groups.set(k, [...(groups.get(k) ?? []), pr]);
  }

  const shipments: Shipment[] = [];
  for (const group of groups.values()) {
    const legs = orderLegs(
      group.map((pr) => ({ promise: pr, route: resolveRoute(pr, routesById, routes) })),
      option.destination ?? {},
      ctx,
    );
    const etaStarts = group.map((g) => g.eta_start).filter((x): x is number => typeof x === 'number');
    const etaEnds = group.map((g) => g.eta_end).filter((x): x is number => typeof x === 'number');
    shipments.push({
      items: (group[0].items ?? []).map((i) => ({ id: i.id, quantity: Number(i.quantity) })),
      legs,
      eta_start: etaStarts.length ? Math.max(...etaStarts) : option.eta_start,
      eta_end: etaEnds.length ? Math.max(...etaEnds) : option.eta_end,
    });
  }
  return shipments;
}

/** Order legs so that each leg arrives where the next one departs; the last one reaches the destination. */
export function orderLegs<T extends { route?: DeliveryRoute }>(legs: T[], destination: Destination, ctx: ZoneContext): T[] {
  if (legs.length < 2 || legs.some((l) => !l.route)) return legs;
  const remaining = [...legs];
  const ordered: T[] = [];
  // Last leg: the one arriving at destination, else the one no other leg departs from.
  let last =
    remaining.find((l) => destinationInZone(ctx.zones.get(l.route!.destination_zone_id ?? ''), destination, ctx)) ??
    remaining.find((l) => !remaining.some((o) => o !== l && zonesConnect(l.route!.destination_zone_id, o.route!.origin_zone_id, ctx)));
  if (!last) return legs;
  ordered.unshift(last);
  remaining.splice(remaining.indexOf(last), 1);
  while (remaining.length) {
    const prev = remaining.find((l) => zonesConnect(l.route!.destination_zone_id, ordered[0].route!.origin_zone_id, ctx));
    if (!prev) break;
    ordered.unshift(prev);
    remaining.splice(remaining.indexOf(prev), 1);
  }
  // Legs that could not be chained are kept first, in their original order.
  return [...remaining, ...ordered];
}

/* ------------------------------------------------------------------------------------------------
 * Formatting helpers
 * ---------------------------------------------------------------------------------------------- */

export function formatHours(min?: number, max?: number, units = { hour: 'h', day: 'j' }): string {
  const f = (h: number) => (h >= 48 && h % 24 === 0 ? `${h / 24}${units.day}` : `${h}${units.hour}`);
  if (min === undefined && max === undefined) return '';
  if (min === undefined || min === max) return f(max ?? 0);
  if (max === undefined) return f(min);
  return `${f(min)} – ${f(max)}`;
}

export const isFulfillable = (o: PromiseOption) => o.status !== 'none';
