/**
 * Carrier timetables used by the local delivery promise.
 *
 * A timetable (GET /timetables) describes a week: timespans `{ start, end, options: { open } }` in seconds from
 * Monday 00:00, in `hours.timezone`. Scheduled events (GET /scheduledevents) close them on given periods.
 *
 *  - carrier_pickup_timetable   : pickup slots = carrier cutoff. A parcel leaves at the next open pickup slot.
 *  - carrier_transit_timetable  : periods during which trucks run. Transit hours only elapse during these periods.
 *  - carrier_delivery_timetable : delivery slots. A parcel is delivered in the next open slot after its arrival.
 */
import type { DeliveryConfig, DeliveryRoute, Endpoint } from './types.js';

export interface Timespan {
  start: number;
  end: number;
  options?: { open?: boolean; [k: string]: unknown };
}

export interface Timetable {
  id: string;
  name?: string;
  type?: string;
  hours?: { timezone?: string; timespans?: Timespan[] };
  /** Version currently in force (GET /timetables/{id}, fields: current_timetable). */
  current_timetable?: unknown;
  /** Routes using this timetable (GET /timetables/{id}, fields: routes): ids or objects with an id. */
  routes?: unknown;
}

/**
 * Normalize a timetable returned by GET /timetables/{id}: slots taken from `current_timetable` (version in force)
 * when present, else from `hours`; `routes` turned into a list of route ids.
 */
export function normalizeTimetable(raw: unknown, fallbackId?: string): Timetable | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = ((raw as Record<string, unknown>).timetable ?? raw) as Record<string, unknown>;
  const id = String(o.id ?? o._id ?? fallbackId ?? '');
  if (!id) return undefined;
  const current = o.current_timetable as Record<string, unknown> | undefined;
  const pickHours = (x: unknown): Timetable['hours'] | undefined => {
    if (!x || typeof x !== 'object') return undefined;
    const h = x as Record<string, unknown>;
    if (Array.isArray(h.timespans)) return h as Timetable['hours'];
    if (h.hours && typeof h.hours === 'object') return pickHours(h.hours);
    return undefined;
  };
  const hours = pickHours(current) ?? pickHours(o.hours) ?? pickHours(o);
  const routes = Array.isArray(o.routes)
    ? (o.routes as unknown[]).map((r) => (typeof r === 'string' ? r : r && typeof r === 'object' ? String((r as Record<string, unknown>).id ?? (r as Record<string, unknown>)._id ?? '') : '')).filter(Boolean)
    : o.routes && typeof o.routes === 'object'
      ? Object.keys(o.routes as object)
      : undefined;
  return { ...(o as object), id, name: (o.name as string) ?? (current?.name as string | undefined), type: (o.type as string) ?? (current?.type as string | undefined), hours, routes } as Timetable;
}

export interface ScheduledEvent {
  id: string;
  name?: string;
  start: number;
  end: number;
  options?: { open?: boolean; [k: string]: unknown };
  timetable_types?: string[];
  links?: { carriers?: string[]; carrier_options?: string[]; zone_ids?: string[]; endpoint_ids?: string[] };
}

export type TimetableRole = 'pickup' | 'transit' | 'delivery';

const WEEK = 7 * 24 * 3600;
const TYPE_OF_ROLE: Record<TimetableRole, string> = {
  pickup: 'carrier_pickup_timetable',
  transit: 'carrier_transit_timetable',
  delivery: 'carrier_delivery_timetable',
};

/* ------------------------------------------------------------------------------------------------
 * Linking routes and timetables
 * ---------------------------------------------------------------------------------------------- */

function roleFromType(type?: string): TimetableRole | undefined {
  const t = (type ?? '').toLowerCase();
  if (t.includes('pickup')) return 'pickup';
  if (t.includes('transit')) return 'transit';
  if (t.includes('delivery')) return 'delivery';
  return undefined;
}

function roleFromField(field: string): TimetableRole | undefined {
  if (/pickup/.test(field)) return 'pickup';
  if (/transit|opening/.test(field)) return 'transit';
  if (/delivery/.test(field)) return 'delivery';
  return undefined;
}

/**
 * Timetables of a route. Any `*timetable_id(s)` field of the route is considered (pickup_timetable_id,
 * delivery_timetable_id, opening_timetable_id, transit_timetable_id...). The role comes from the timetable type,
 * or from the field name when the type is unknown.
 */
export function routeTimetables(route: DeliveryRoute, timetables: Map<string, Timetable>): Partial<Record<TimetableRole, Timetable>> {
  const result: Partial<Record<TimetableRole, Timetable>> = {};
  // 1. timetables declaring the route in their `routes` (GET /timetables/{id}, fields: routes)
  for (const tt of timetables.values()) {
    const role = roleFromType(tt.type);
    if (role && !result[role] && Array.isArray(tt.routes) && (tt.routes as string[]).includes(route.id)) result[role] = tt;
  }
  // 2. *_timetable_id fields of the route
  for (const [field, value] of Object.entries(route as unknown as Record<string, unknown>)) {
    if (!/timetable/i.test(field)) continue;
    const ids = Array.isArray(value) ? value : [value];
    for (const id of ids) {
      if (typeof id !== 'string' || !id) continue;
      const tt = timetables.get(id);
      const role = roleFromType(tt?.type) ?? roleFromField(field);
      if (role && !result[role]) result[role] = tt ?? { id };
    }
  }
  return result;
}

/* ------------------------------------------------------------------------------------------------
 * Time zone helpers
 * ---------------------------------------------------------------------------------------------- */

const formatters = new Map<string, Intl.DateTimeFormat>();
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Seconds elapsed since Monday 00:00 (local time of the time zone) at the given instant. */
export function secondsInWeek(ts: number, timeZone = 'UTC'): number {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    } catch {
      f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    }
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(ts * 1000)).map((p) => [p.type, p.value]));
  return DAYS.indexOf(parts.weekday) * 86400 + (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
}

/* ------------------------------------------------------------------------------------------------
 * Calendar
 * ---------------------------------------------------------------------------------------------- */

export interface Interval {
  start: number;
  end: number;
}

/** Open intervals of a timetable, minus the closures, over a horizon. No timetable = always open. */
export class Calendar {
  private readonly spans: Timespan[];
  private readonly tz: string;

  constructor(
    readonly timetable: Timetable | undefined,
    private readonly closures: Interval[] = [],
    private readonly horizonWeeks = 8,
  ) {
    this.spans = (timetable?.hours?.timespans ?? []).filter((s) => s.options?.open !== false && s.end > s.start);
    this.tz = timetable?.hours?.timezone ?? 'UTC';
  }

  /** The timetable is defined (has open spans): otherwise the calendar is always open. */
  get constrained(): boolean {
    return this.spans.length > 0 || this.closures.length > 0;
  }

  /** Open intervals from `from` (included) over the horizon, sorted. */
  intervals(from: number): Interval[] {
    let raw: Interval[];
    if (!this.spans.length) raw = [{ start: from, end: from + this.horizonWeeks * WEEK }];
    else {
      const weekStart = from - secondsInWeek(from, this.tz);
      raw = [];
      for (let w = -1; w <= this.horizonWeeks; w++)
        for (const s of this.spans) raw.push({ start: weekStart + w * WEEK + s.start, end: weekStart + w * WEEK + s.end });
      raw.sort((a, b) => a.start - b.start);
      // Merge contiguous spans (OneStock timespans end at :59 or :01, e.g. 0 -> 604799 for a full week).
      const merged: Interval[] = [];
      for (const iv of raw) {
        const last = merged[merged.length - 1];
        if (last && iv.start <= last.end + 1) last.end = Math.max(last.end, iv.end);
        else merged.push({ ...iv });
      }
      raw = merged;
    }
    const result: Interval[] = [];
    for (const iv of raw) {
      if (iv.end <= from) continue;
      let pieces = [{ start: Math.max(iv.start, from), end: iv.end }];
      for (const c of this.closures) {
        pieces = pieces.flatMap((p) => {
          if (c.end <= p.start || c.start >= p.end) return [p];
          const out: Interval[] = [];
          if (c.start > p.start) out.push({ start: p.start, end: c.start });
          if (c.end < p.end) out.push({ start: c.end, end: p.end });
          return out;
        });
      }
      result.push(...pieces.filter((p) => p.end > p.start));
    }
    return result;
  }

  /** First open interval containing or after `t` (start clipped to t), undefined beyond the horizon. */
  next(t: number): Interval | undefined {
    return this.intervals(t)[0];
  }

  /** Instant reached after `hours` of open time starting at `t`, undefined beyond the horizon. */
  advance(t: number, hours: number): number | undefined {
    let remaining = Math.round(hours * 3600);
    if (remaining <= 0) return this.constrained ? this.next(t)?.start : t;
    for (const iv of this.intervals(t)) {
      const avail = iv.end - iv.start;
      if (avail >= remaining) return iv.start + remaining;
      remaining -= avail;
    }
    return undefined;
  }
}

/** Closures of a role for a route (scheduled events with open = false). Transit closures stop every operation. */
export function closuresFor(role: TimetableRole, route: DeliveryRoute, events: ScheduledEvent[], zoneId?: string): Interval[] {
  return events
    .filter((e) => e.options?.open === false)
    .filter((e) => {
      const types = e.timetable_types ?? [];
      return types.includes(TYPE_OF_ROLE[role]) || types.includes(TYPE_OF_ROLE.transit);
    })
    .filter((e) => {
      const l = e.links ?? {};
      if (l.carriers?.length && !l.carriers.includes(route.carrier.name)) return false;
      if (l.carrier_options?.length && !l.carrier_options.includes(route.carrier.option)) return false;
      if (l.zone_ids?.length && (!zoneId || !l.zone_ids.includes(zoneId))) return false;
      return true;
    })
    .map((e) => ({ start: e.start, end: e.end }));
}

/* ------------------------------------------------------------------------------------------------
 * Leg timing
 * ---------------------------------------------------------------------------------------------- */

export interface LegTiming {
  route_id: string;
  /** Parcel ready at the origin of the leg. */
  ready: number;
  /** Pickup slot used (its end is the carrier cutoff). */
  pickup?: { name?: string; start: number; end: number };
  departure: number;
  transit_timetable?: string;
  /** Arrival before the delivery slot. */
  arrival: number;
  /** Delivery slot used. */
  slot?: { name?: string; start: number; end: number };
  /** Delivered / available for the next leg. */
  delivered: number;
}

export interface TimingContext {
  timetables: Map<string, Timetable>;
  events: ScheduledEvent[];
}

/**
 * Time a chain of legs from `ready`, with `transit` = 'min' or 'max' transit hours.
 * Returns undefined when a timetable has no open slot over the horizon.
 */
export function timeLegs(routes: DeliveryRoute[], ready: number, transit: 'min' | 'max', ctx: TimingContext): LegTiming[] | undefined {
  const result: LegTiming[] = [];
  let t = ready;
  for (const route of routes) {
    const tts = routeTimetables(route, ctx.timetables);
    const pickupCal = new Calendar(tts.pickup, closuresFor('pickup', route, ctx.events, route.origin_zone_id));
    const transitCal = new Calendar(tts.transit, closuresFor('transit', route, ctx.events, route.origin_zone_id));
    const deliveryCal = new Calendar(tts.delivery, closuresFor('delivery', route, ctx.events, route.destination_zone_id));

    const pickup = pickupCal.constrained ? pickupCal.next(t) : undefined;
    if (pickupCal.constrained && !pickup) return undefined;
    const departure = pickup ? pickup.start : t;
    const hours = transit === 'min' ? (route.minimum_transit_hours ?? 0) : (route.maximum_transit_hours ?? route.minimum_transit_hours ?? 0);
    const arrival = transitCal.advance(departure, hours);
    if (arrival === undefined) return undefined;
    const slot = deliveryCal.constrained ? deliveryCal.next(arrival) : undefined;
    if (deliveryCal.constrained && !slot) return undefined;
    // min track: delivered at the start of the slot; max track: at the end of the slot ("end of delivery slot").
    const delivered = slot ? (transit === 'min' ? slot.start : slot.end) : arrival;
    result.push({
      route_id: route.id,
      ready: t,
      pickup: pickup ? { name: tts.pickup?.name, start: pickup.start, end: pickup.end } : undefined,
      departure,
      transit_timetable: tts.transit?.name,
      arrival,
      slot: slot ? { name: tts.delivery?.name, start: slot.start, end: slot.end } : undefined,
      delivered,
    });
    t = delivered;
  }
  return result;
}

/* ------------------------------------------------------------------------------------------------
 * Operations (execution times)
 * ---------------------------------------------------------------------------------------------- */

/** GET /execution_times: duration of an operation and the timetable during which it can be executed. */
export interface ExecutionTime {
  id: string;
  name?: string;
  operation?: string;
  /** "12h", "24m"... */
  duration?: string;
  execution_moment?: string;
  /** execution_time_timetable */
  timetable_id?: string;
}

export type OperationMoment = 'always_at_start' | 'before_shipping' | 'after_shipping' | 'from_destination';

export interface OperationTiming {
  operation: string;
  moment: OperationMoment;
  execution_time?: string;
  hours: number;
  /** Name of the calendar used (execution timetable or opening hours of the stock location). */
  calendar?: string;
  start: number;
  end: number;
  /** The execution time could not be read (e.g. GET /execution_times not allowed): duration counted as 0. */
  unknown?: boolean;
}

export interface OperationsContext extends TimingContext {
  executionTimes: Map<string, ExecutionTime>;
}

/** Parse a duration: "2h", "30m", "1d", "PT2H30M", "02:30", or a number of minutes. */
export function parseDurationHours(v: unknown): number {
  if (typeof v === 'number') return v / 60;
  if (typeof v !== 'string') return 0;
  const s = v.trim().toUpperCase();
  const iso = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (iso && s !== 'P') return Number(iso[1] ?? 0) * 24 + Number(iso[2] ?? 0) + Number(iso[3] ?? 0) / 60 + Number(iso[4] ?? 0) / 3600;
  const hm = s.match(/^(\d+):(\d{2})$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  // only a value made entirely of durations ("1d 2h", "30m"), not an identifier containing "1h"
  if (!/^(\d+(?:\.\d+)?\s*(D|H|MIN|M|S)\s*)+$/.test(s)) return /^\d+(\.\d+)?$/.test(s) ? Number(s) / 60 : 0;
  let total = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(D|H|MIN|M|S)/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === 'D' ? n * 24 : m[2] === 'H' ? n : m[2] === 'S' ? n / 3600 : n / 60;
  }
  if (matched) return total;
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) / 60 : 0;
}

/** Moment of a key of `delivery_config.operations` (official moments, or older labels). */
export function momentOf(key: string): OperationMoment | undefined {
  const k = key.toLowerCase();
  if (k === 'always_at_start' || /start/.test(k)) return 'always_at_start';
  if (k === 'before_shipping' || (/ship/.test(k) && !/after/.test(k))) return 'before_shipping';
  if (k === 'after_shipping' || /after|receiv/.test(k)) return 'after_shipping';
  if (k === 'from_destination' || /destination|collection|fulfil/.test(k)) return 'from_destination';
  return undefined;
}

/** Operations of a moment, in the configuration order. */
export function operationsOf(config: DeliveryConfig, moment: OperationMoment): string[] {
  return Object.entries((config.operations ?? {}) as Record<string, string[]>)
    .filter(([k]) => momentOf(k) === moment)
    .flatMap(([, ops]) => ops ?? []);
}

/**
 * Execution time of an operation: the one of the stock location (endpoint.execution_times), else the one of the
 * configuration (global_execution_times: operation -> execution time id). A value that is not a known id but a
 * duration ("2h") is accepted as is.
 */
export function executionTimeFor(
  op: string,
  config: DeliveryConfig,
  endpoint: Endpoint | undefined,
  ctx: OperationsContext,
): { id?: string; et?: ExecutionTime; hours: number; unknown: boolean } {
  const ref = endpoint?.execution_times?.find((e) => e.operation === op)?.id ?? (config.global_execution_times as Record<string, string> | undefined)?.[op];
  const et = ref ? ctx.executionTimes.get(ref) : undefined;
  if (et) return { id: et.id, et, hours: parseDurationHours(et.duration), unknown: false };
  const hours = parseDurationHours(ref);
  // an id that could not be loaded (not a duration written in place): unknown duration, counted as 0
  return { id: ref, hours, unknown: !!ref && hours === 0 && !/^0+\s*[a-z]*$/i.test(ref) };
}

function endpointClosures(endpoint: Endpoint | undefined, events: ScheduledEvent[]): Interval[] {
  if (!endpoint) return [];
  return events
    .filter((e) => e.options?.open === false && (e.timetable_types ?? []).includes('endpoint_timetable') && (e.links?.endpoint_ids ?? []).includes(endpoint.id))
    .map((e) => ({ start: e.start, end: e.end }));
}

/**
 * Run the operations of a moment from `start`. Each duration only elapses during the open periods of the execution
 * time timetable (execution_time_timetable), else of the opening hours of the stock location, else continuously.
 * Returns undefined when a calendar has no open period over the horizon.
 */
export function runOperations(
  moment: OperationMoment,
  config: DeliveryConfig,
  endpoint: Endpoint | undefined,
  start: number,
  ctx: OperationsContext,
): { end: number; steps: OperationTiming[] } | undefined {
  let t = start;
  const steps: OperationTiming[] = [];
  for (const op of operationsOf(config, moment)) {
    const { id, et, hours, unknown } = executionTimeFor(op, config, endpoint, ctx);
    const tt = et?.timetable_id ? ctx.timetables.get(et.timetable_id) : undefined;
    const opening = !tt && endpoint?.opening_hours?.timespans?.length
      ? ({ id: `${endpoint.id}:opening`, name: endpoint.name ?? endpoint.id, hours: { timezone: endpoint.opening_hours.timezone ?? endpoint.timezone, timespans: endpoint.opening_hours.timespans } } as Timetable)
      : undefined;
    const cal = new Calendar(tt ?? opening, endpointClosures(endpoint, ctx.events));
    const begin = hours > 0 && cal.constrained ? cal.next(t)?.start : t;
    const end = cal.advance(t, hours);
    if (end === undefined || begin === undefined) return undefined;
    steps.push({ operation: op, moment, execution_time: et?.name ?? id, hours, calendar: (tt ?? opening)?.name, start: begin, end, unknown: unknown || undefined });
    t = end;
  }
  return { end: t, steps };
}
