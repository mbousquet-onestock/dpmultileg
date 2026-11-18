import { describe, expect, it } from 'vitest';
import { mockRoutes, mockScheduledEvents, mockTimetables } from '../server/src/mock.js';
import { Calendar, closuresFor, normalizeTimetable, routeTimetables, secondsInWeek, timeLegs, type Timetable } from './timetables.js';

const timetables = new Map<string, Timetable>(mockTimetables.map((t) => [t.id, t]));
const route = (id: string) => mockRoutes.find((r) => r.id === id)!;
// Friday 20 Nov 2026 18:00 Europe/Paris (17:00 UTC)
const FRIDAY_18H = 1795194000;
const H = 3600;

describe('timetables', () => {
  it('computes the position in the week in the timetable time zone', () => {
    expect(secondsInWeek(FRIDAY_18H, 'Europe/Paris')).toBe(4 * 86400 + 18 * H);
    expect(secondsInWeek(FRIDAY_18H, 'UTC')).toBe(4 * 86400 + 17 * H);
  });

  it('links a route to its pickup, transit and delivery timetables', () => {
    const tts = routeTimetables(route('r_wh_fr_colissimo'), timetables);
    expect(tts.pickup?.id).toBe('tt_colissimo_pickup');
    expect(tts.transit?.id).toBe('tt_trucks_weekdays');
    expect(tts.delivery?.id).toBe('tt_colissimo_delivery');
  });

  it('finds the next pickup slot and makes transit elapse only on running days', () => {
    const pickup = new Calendar(timetables.get('tt_colissimo_pickup'));
    // Friday 18:00 is after the cutoff (17:00): next pickup on Monday 16:00
    expect(pickup.next(FRIDAY_18H)).toEqual({ start: FRIDAY_18H + (2 * 24 + 22) * H, end: FRIDAY_18H + (2 * 24 + 23) * H });
    const trucks = new Calendar(timetables.get('tt_trucks_weekdays'));
    // 10h of transit from Friday 18:00: 6h on Friday, the remaining 4h on Monday morning
    expect(trucks.advance(FRIDAY_18H, 10)).toBe(FRIDAY_18H + (2 * 24 + 6 + 4) * H);
  });

  it('times a leg: cutoff, transit days, end of delivery slot', () => {
    const fast = timeLegs([route('r_wh_fr_colissimo')], FRIDAY_18H, 'min', { timetables, events: [] })!;
    const slow = timeLegs([route('r_wh_fr_colissimo')], FRIDAY_18H, 'max', { timetables, events: [] })!;
    const monday16 = FRIDAY_18H + (2 * 24 + 22) * H;
    expect(fast[0].pickup).toMatchObject({ start: monday16, end: monday16 + H });
    expect(fast[0].delivered).toBe(monday16 + 24 * H); // Tuesday 16:00, inside the 8h-18h slot
    expect(slow[0].delivered).toBe(monday16 + 72 * H + 2 * H); // Thursday, end of the slot (18:00)
  });

  it('chains legs: the arrival of a leg is the ready time of the next one', () => {
    const legs = timeLegs([route('r_wh_hub_paris'), route('r_hub_idf_sdd')], FRIDAY_18H, 'max', { timetables, events: [] })!;
    expect(legs[1].ready).toBe(legs[0].delivered);
    expect(legs[1].departure).toBeGreaterThanOrEqual(legs[0].delivered);
  });

  it('applies scheduled events closing a carrier', () => {
    const closures = closuresFor('delivery', route('r_wh_fr_colissimo'), mockScheduledEvents);
    expect(closures).toHaveLength(1);
    expect(closuresFor('delivery', route('r_hub_idf_sdd'), mockScheduledEvents)).toEqual([]);
    const cal = new Calendar(timetables.get('tt_colissimo_delivery'), [{ start: FRIDAY_18H, end: FRIDAY_18H + 4 * 86400 }]);
    expect(cal.next(FRIDAY_18H)!.start).toBeGreaterThanOrEqual(FRIDAY_18H + 4 * 86400);
  });

  it('is always open without timetable', () => {
    expect(new Calendar(undefined).advance(FRIDAY_18H, 5)).toBe(FRIDAY_18H + 5 * H);
  });
});

describe('GET /timetables/{id} response', () => {
  // Real response (carrier_delivery_timetable "Colissimo"): Mon-Fri 8h-18h, Saturday 8h-13h, Europe/Paris
  const response = {
    timetable: {
      id: '6e3ff3b2-d9c8-4fa7-8127-4061443a2a6b',
      name: 'Colissimo',
      type: 'carrier_delivery_timetable',
      current_timetable: {
        from: 1794908280,
        to: 0,
        timezone: 'Europe/Paris',
        timespans: [
          { start: 28800, end: 64801, options: { open: true } },
          { start: 115200, end: 151201, options: { open: true } },
          { start: 201600, end: 237601, options: { open: true } },
          { start: 288000, end: 324001, options: { open: true } },
          { start: 374400, end: 410401, options: { open: true } },
          { start: 460800, end: 478801, options: { open: true } },
        ],
      },
      last_update: 1794908280,
    },
  };

  it('reads the slots of the version in force', () => {
    const tt = normalizeTimetable(response)!;
    expect(tt).toMatchObject({ id: '6e3ff3b2-d9c8-4fa7-8127-4061443a2a6b', name: 'Colissimo', type: 'carrier_delivery_timetable' });
    expect(tt.hours?.timezone).toBe('Europe/Paris');
    expect(tt.hours?.timespans).toHaveLength(6);
  });

  it('gives the next delivery slot: Friday 18:30 -> Saturday 8h-13h', () => {
    const cal = new Calendar(normalizeTimetable(response));
    expect(cal.next(FRIDAY_18H + 1800)).toEqual({ start: FRIDAY_18H + 14 * H, end: FRIDAY_18H + 19 * H + 1 });
  });

  it('links a route through its timetable fields or the timetable routes', () => {
    const tt = { ...normalizeTimetable(response)!, routes: ['r_custom'] };
    const map = new Map([[tt.id, tt]]);
    expect(routeTimetables({ id: 'r_custom', carrier: { name: 'colissimo', option: 'home' } }, map).delivery?.name).toBe('Colissimo');
    expect(routeTimetables({ id: 'r_other', carrier: { name: 'colissimo', option: 'home' }, delivery_timetable_id: tt.id }, map).delivery?.id).toBe(tt.id);
  });
});

describe('GET /timetables/{id} carrier_pickup_timetable (cutoff instants)', () => {
  // Real response "Colissimo": 1 second timespans = carrier cutoffs.
  // Mon-Thu 12:00 and 19:00, Friday 11:00 and 17:00, Saturday 13:00 (Europe/Paris)
  const pickup = normalizeTimetable({
    timetable: {
      id: '2dced4fc-51b2-4d6c-8bb0-3523abbe4f13',
      name: 'Colissimo',
      type: 'carrier_pickup_timetable',
      current_timetable: {
        from: 1794908280,
        to: 0,
        timezone: 'Europe/Paris',
        timespans: [43200, 68400, 129600, 154800, 216000, 241200, 302400, 327600, 385200, 406800, 478800].map((start) => ({
          start,
          end: start + 1,
          options: { open: true },
        })),
      },
    },
  })!;
  const cal = new Calendar(pickup);
  const WEDNESDAY_00H = FRIDAY_18H - (2 * 24 + 18) * H;

  it('leaves at the next cutoff of the day', () => {
    expect(cal.next(WEDNESDAY_00H + 12.5 * H)?.start).toBe(WEDNESDAY_00H + 19 * H);
    expect(cal.next(WEDNESDAY_00H + 9 * H)?.start).toBe(WEDNESDAY_00H + 12 * H);
  });

  it('after the last Friday cutoff (17:00), leaves on Saturday 13:00', () => {
    expect(cal.next(FRIDAY_18H)?.start).toBe(FRIDAY_18H + 19 * H);
  });

  it('after Saturday 13:00, waits for Monday 12:00', () => {
    expect(cal.next(FRIDAY_18H + 20 * H)?.start).toBe(FRIDAY_18H + (2 * 24 + 18) * H);
  });
});

describe('GET /timetables/{id} execution_time_timetable "France" (open 24/7)', () => {
  const france = normalizeTimetable({
    timetable: {
      id: '3153a164-2f72-4094-b502-a4088aec157f',
      name: 'France',
      type: 'execution_time_timetable',
      current_timetable: { from: 1794908280, to: 0, timezone: 'Europe/Paris', timespans: [{ start: 0, end: 604799, options: { open: true } }] },
    },
  })!;

  it('lets operations run continuously, across the week boundary', () => {
    const cal = new Calendar(france);
    const SUNDAY_23H = FRIDAY_18H + (2 * 24 + 5) * H;
    expect(cal.advance(FRIDAY_18H, 2)).toBe(FRIDAY_18H + 2 * H);
    expect(cal.advance(SUNDAY_23H, 2)).toBe(SUNDAY_23H + 2 * H);
  });
});

describe('real Colissimo timetables chained (pickup -> transit Mon-Sat -> delivery)', () => {
  const tz = 'Europe/Paris';
  const make = (id: string, type: string, timespans: { start: number; end: number }[]) =>
    normalizeTimetable({ timetable: { id, name: 'Colissimo', type, current_timetable: { timezone: tz, timespans: timespans.map((x) => ({ ...x, options: { open: true } })) } } })!;
  const pickup = make('pickup', 'carrier_pickup_timetable', [43200, 68400, 129600, 154800, 216000, 241200, 302400, 327600, 385200, 406800, 478800].map((v) => ({ start: v, end: v + 1 })));
  const transit = make('transit', 'carrier_transit_timetable', [{ start: 0, end: 518399 }]);
  const delivery = make('delivery', 'carrier_delivery_timetable', [
    { start: 28800, end: 64801 },
    { start: 115200, end: 151201 },
    { start: 201600, end: 237601 },
    { start: 288000, end: 324001 },
    { start: 374400, end: 410401 },
    { start: 460800, end: 478801 },
  ]);
  const colissimo = { id: 'r_colissimo', carrier: { name: 'colissimo', option: 'home' }, minimum_transit_hours: 24, maximum_transit_hours: 48 };
  const timetables = new Map<string, Timetable>([pickup, transit, delivery].map((tt) => [tt.id, { ...tt, routes: ['r_colissimo'] }]));

  it('trucks do not run on Sunday', () => {
    const SATURDAY_12H = FRIDAY_18H + 18 * H;
    // 24h of transit from Saturday 12:00: 12h on Saturday, nothing on Sunday, 12h on Monday -> Monday 12:00
    // (OneStock spans end at 23:59:59: 1 second tolerance)
    expect(Math.abs(new Calendar(transit).advance(SATURDAY_12H, 24)! - (SATURDAY_12H + (12 + 24 + 12) * H))).toBeLessThanOrEqual(1);
  });

  it('ready Friday 18:00: pickup Saturday 13:00, delivered Monday (min) to Tuesday end of slot (max)', () => {
    const ctx = { timetables, events: [] };
    const fast = timeLegs([colissimo], FRIDAY_18H, 'min', ctx)![0];
    const slow = timeLegs([colissimo], FRIDAY_18H, 'max', ctx)![0];
    const saturday13 = FRIDAY_18H + 19 * H;
    expect(fast.pickup?.start).toBe(saturday13);
    // min 24h: 11h on Saturday + 13h on Monday -> Monday 13:00, inside the 8h-18h slot
    expect(Math.abs(fast.arrival - (saturday13 + (11 + 24 + 13) * H))).toBeLessThanOrEqual(1);
    expect(fast.delivered).toBe(fast.arrival);
    // max 48h: 11h Saturday + 24h Monday + 13h Tuesday -> Tuesday 13:00, end of the slot = 18:00
    expect(Math.abs(slow.arrival - (saturday13 + (11 + 24 + 24 + 13) * H))).toBeLessThanOrEqual(1);
    expect(slow.delivered).toBe(saturday13 + (11 + 24 + 24 + 18) * H + 1); // Tuesday 18:00:01
  });
});
