import { describe, expect, it } from 'vitest';
import { normalizeRoutes } from './normalize.js';
import { selectVariant } from './promise.js';
import type { Item } from './types.js';

const tt = { pickup_timetable_id: '2dced4fc-51b2-4d6c-8bb0-3523abbe4f13', opening_timetable_id: 'a1bbe9f2-5259-4b50-bada-b6bc45fd6db4', delivery_timetable_id: '6e3ff3b2-d9c8-4fa7-8127-4061443a2a6b' };
const row = (id: string, cost: number, fees: number, parcel: unknown[], order: unknown[]) => ({
  carrier: { name: 'colissimov2', option: 'DOM' },
  id,
  origin_zone_id: 'France',
  destination_zone_id: 'France',
  ...tt,
  metric_values: { carbon_footprint: 1200, cost_by_parcel: cost, shipping_fees: fees },
  minimum_transit_hours: 48,
  maximum_transit_hours: 72,
  constraints: { parcel_info: [], parcel_constraints: parcel, order_constraints: order },
  carrier_information: null,
  version: 10,
});
const priceLt = [{ name: 'price', op: 'lt', value: 100 }];
const priceGte = [{ name: 'price', op: 'gte', value: 100 }];

// Real GET /delivery_routes response (route group of colissimov2 / DOM)
const response = {
  public_id: 'colissimov2_DOM__France_France_48_72_2dced4fc-51b2-4d6c-8bb0-3523abbe4f13_a1bbe9f2-5259-4b50-bada-b6bc45fd6db4_6e3ff3b2-d9c8-4fa7-8127-4061443a2a6b',
  carrier_name: 'colissimov2',
  carrier_option: 'DOM',
  carrier_information: null,
  origin_zone_id: 'France',
  destination_zone_id: 'France',
  minimum_transit_hours: 48,
  maximum_transit_hours: 72,
  ...tt,
  min_cost_by_parcel: 5,
  max_cost_by_parcel: 7,
  has_routes: true,
  routes: [
    {
      routes: [
        row('67e5503f420e158b6d5fa6f5', 5, 4.99, [{ formula: 'W', op: 'lt', value: 10 }, { formula: 'qty', op: 'lt', value: 10 }], priceLt),
        row('67e5505e6eed8a73e7a0afe0', 7, 5.99, [{ formula: 'W', op: 'gte', value: 10 }], priceLt),
      ],
      order_constraints: priceLt,
    },
    {
      routes: [
        row('67e55067420e158b6d5fa6f7', 7, 2.99, [{ formula: 'W', op: 'gte', value: 10 }], priceGte),
        row('67e550676eed8a73e7a0afe2', 5, 0.99, [{ formula: 'W', op: 'lt', value: 10 }], priceGte),
      ],
      order_constraints: priceGte,
    },
  ],
  timezone: null,
};

const items = new Map<string, Item>([
  ['light', { id: 'light', price: 40, attributes: { weight: [3] } }],
  ['tiny', { id: 'tiny', price: 5, attributes: { weight: [0.5] } }],
  ['fridge', { id: 'fridge', price: 60, weight: 55, attributes: { weight: [55] } }],
  ['heavy', { id: 'heavy', price: 40, attributes: { weight: [12] } }],
  ['noweight', { id: 'noweight', price: 150, attributes: {} }],
]);

describe('GET /delivery_routes groups', () => {
  const routes = normalizeRoutes([response]);
  const route = routes[0];

  it('turns a group into one route with its cost table rows', () => {
    expect(routes).toHaveLength(1);
    expect(route).toMatchObject({
      id: response.public_id,
      carrier: { name: 'colissimov2', option: 'DOM' },
      origin_zone_id: 'France',
      destination_zone_id: 'France',
      minimum_transit_hours: 48,
      maximum_transit_hours: 72,
      ...tt,
    });
    expect(route.variants).toHaveLength(4);
    expect(route.variants![0].order_constraints).toEqual(priceLt);
  });

  it('also accepts { delivery_routes: [...] } and a single group', () => {
    expect(normalizeRoutes({ delivery_routes: [response] })[0].id).toBe(response.public_id);
    expect(normalizeRoutes(response)[0].variants).toHaveLength(4);
  });

  it('picks the cost table row matching weight, quantity and order price', () => {
    const pick = (item: string, qty: number, price?: number) => selectVariant(route, [{ item_id: item, qty }], items, price);
    expect(pick('light', 1, 40).variant?.id).toBe('67e5503f420e158b6d5fa6f5'); // W < 10, price < 100 -> 5 €
    expect(pick('heavy', 1, 40).variant?.id).toBe('67e5505e6eed8a73e7a0afe0'); // W >= 10, price < 100 -> 7 €
    expect(pick('heavy', 1, 150).variant?.id).toBe('67e55067420e158b6d5fa6f7'); // W >= 10, price >= 100
    expect(pick('light', 3, 120).variant?.id).toBe('67e550676eed8a73e7a0afe2'); // W < 10, price >= 100 -> 0.99 € fees
    expect(pick('light', 1, 40).conditions).toBe('W < 10, qty < 10, price < 100');
  });

  it('excludes the route when no row matches', () => {
    // 12 items of 0.5 kg (W = 6), price < 100: W < 10 needs qty < 10, W >= 10 is false -> no row
    const choice = selectVariant(route, [{ item_id: 'tiny', qty: 12 }], items, 60);
    expect(choice.variant).toBeUndefined();
    expect(choice.failure).toContain('qty = 12');
  });

  it('ignores constraints that can not be evaluated and reports them', () => {
    const choice = selectVariant(route, [{ item_id: 'noweight', qty: 1 }], items, 150);
    expect(choice.variant).toBeDefined();
    expect(choice.unknown).toContain('W ≥ 10');
  });

  it('a 55 kg item: the W >= 10 row of this table applies (no upper weight limit in it)', () => {
    expect(selectVariant(route, [{ item_id: 'fridge', qty: 1 }], items, 60).variant?.id).toBe('67e5505e6eed8a73e7a0afe0');
  });

  it('a route with a maximum weight excludes a 55 kg item', () => {
    const capped = normalizeRoutes([
      { ...response, routes: [{ routes: [row('cap', 7, 5.99, [{ formula: 'W', op: 'lt', value: 30 }], priceLt)], order_constraints: priceLt }] },
    ])[0];
    const choice = selectVariant(capped, [{ item_id: 'fridge', qty: 1 }], items, 60);
    expect(choice.variant).toBeUndefined();
    expect(choice.failure).toContain('W = 55');
  });
});

