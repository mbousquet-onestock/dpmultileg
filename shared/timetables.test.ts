import { describe, expect, it } from 'vitest';
import { mockRoutes, mockScheduledEvents, mockTimetables } from '../server/src/mock.js';
import { Calendar, closuresFor, routeTimetables, secondsInWeek, timeLegs, type Timetable } from './timetables.js';

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
