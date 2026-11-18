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
import type { DeliveryRoute } from './types.js';

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
