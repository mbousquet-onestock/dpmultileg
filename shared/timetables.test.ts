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
