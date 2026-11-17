import { describe, expect, it } from 'vitest';
import { mockConfigs, mockEndpoints, mockRestrictions, mockRoutes, mockSortOrders, mockZones } from '../server/src/mock.js';
import {
  buildSchemas,
  collectStockLines,
  decisiveCriterion,
  restrictionsForRoute,
  sortOrderFor,
  isStockZone,
  matchShipmentsToSchemas,
  orderLegs,
  originAvailability,
  shipmentsFromPromise,
  zoneContains,
  zonesConnect,
  type ZoneContext,
} from './logistics.js';
import { asList } from './normalize.js';

const ctx: ZoneContext = {
  zones: new Map(mockZones.map((z) => [z.id, z])),
  endpoints: new Map(mockEndpoints.map((e) => [e.id, e])),
};
const cfg = (id: string) => mockConfigs.find((c) => c.id === id)!;
const ids = (s: { legs: { route: { id: string } }[] }) => s.legs.map((l) => l.route.id).join('>');

describe('zones', () => {
  it('matches countries, zip regex and exclusions', () => {
    const fr = ctx.zones.get('z_fr');
    expect(zoneContains(fr, { location: { country: 'FR', zip_code: '75011' } }, ctx)).toBe(true);
    expect(zoneContains(fr, { location: { country: 'FR', zip_code: '20000' } }, ctx)).toBe(false);
    expect(zoneContains(fr, { location: { country: 'BE' } }, ctx)).toBe(false);
    expect(zoneContains(ctx.zones.get('z_idf'), { location: { country: 'FR', zip_code: '92230' } }, ctx)).toBe(true);
  });
  it('handles included zones and endpoints', () => {
    expect(zoneContains(ctx.zones.get('z_fr_all'), { location: { country: 'FR', zip_code: '20090' } }, ctx)).toBe(true);
    expect(zoneContains(ctx.zones.get('z_stores_fr'), { endpoint_id: 'ST_LYON' }, ctx)).toBe(true);
    expect(zoneContains(ctx.zones.get('z_stores_fr'), { endpoint_id: 'WH_TLS' }, ctx)).toBe(false);
  });
  it('only chains through stock zones', () => {
    expect(isStockZone(ctx.zones.get('z_hub_paris'), ctx)).toBe(true);
    expect(isStockZone(ctx.zones.get('z_fr'), ctx)).toBe(false);
    expect(zonesConnect('z_hub_paris', 'z_hub_paris', ctx)).toBe(true);
    expect(zonesConnect('z_stores_fr', 'z_stores_idf', ctx)).toBe(true); // share ST_PARIS
    expect(zonesConnect('z_fr', 'z_stores_idf', ctx)).toBe(false);
  });
});

describe('buildSchemas', () => {
  it('finds the multi-leg warehouse -> hub -> same day schema', () => {
    const schemas = buildSchemas(cfg('cfg_sdd'), { location: { country: 'FR', zip_code: '75011' } }, mockRoutes, ctx);
    const keys = schemas.map(ids);
    expect(keys).toContain('r_stores_idf_sdd');
    expect(keys).toContain('r_wh_hub_paris>r_hub_idf_sdd');
    // geographic zones are never an intermediate step
    expect(keys.some((k) => k.includes('colissimo'))).toBe(false);
    expect(schemas.every((s) => s.legs.at(-1)!.route.carrier.name === 'stuart')).toBe(true);
  });
  it('respects the configuration delivery zones', () => {
    expect(buildSchemas(cfg('cfg_sdd'), { location: { country: 'FR', zip_code: '31000' } }, mockRoutes, ctx)).toEqual([]);
  });
  it('reaches Corsica through the Marseille hub', () => {
    const keys = buildSchemas(cfg('cfg_hd_std'), { location: { country: 'FR', zip_code: '20000' } }, mockRoutes, ctx).map(ids);
    expect(keys).toContain('r_wh_hub_mrs>r_hub_corse_ferry');
    expect(keys).not.toContain('r_wh_fr_colissimo');
  });
});

describe('promise routes', () => {
  it('groups by items and orders legs from origin to destination', () => {
    const shipments = shipmentsFromPromise(
      {
        delivery_method: 'SDD',
        status: 'valid',
        destination: { location: { country: 'FR', zip_code: '75011' } },
        delivery_routes: [
          { id: 'r_hub_idf_sdd', carrier: { name: 'stuart', option: 'same_day' }, items: [{ id: 'A', quantity: 1 }] },
          { id: 'r_wh_hub_paris', carrier: { name: 'geodis', option: 'linehaul' }, items: [{ id: 'A', quantity: 1 }] },
          { id: 'r_stores_idf_sdd', carrier: { name: 'stuart', option: 'same_day' }, items: [{ id: 'B', quantity: 2 }] },
        ],
      },
      mockRoutes,
      ctx,
    );
    expect(shipments).toHaveLength(2);
    expect(shipments[0].legs.map((l) => l.route?.id)).toEqual(['r_wh_hub_paris', 'r_hub_idf_sdd']);
    expect(shipments[1].items).toEqual([{ id: 'B', quantity: 2 }]);
  });
  it('resolves routes by carrier when the id is missing', () => {
    const legs = orderLegs(
      [{ route: mockRoutes.find((r) => r.id === 'r_hub_corse_ferry') }, { route: mockRoutes.find((r) => r.id === 'r_wh_hub_mrs') }],
      { location: { country: 'FR', zip_code: '20000' } },
      ctx,
    );
    expect(legs.map((l) => l.route!.id)).toEqual(['r_wh_hub_mrs', 'r_hub_corse_ferry']);
  });
});

describe('asList', () => {
  it('accepts arrays, keyed objects and wrapped payloads', () => {
    expect(asList({ zones: [{ id: 'a' }] }, 'zones')).toEqual([{ id: 'a' }]);
    expect(asList({ zones: { b: { name: 'B' } } }, 'zones')).toEqual([{ id: 'b', name: 'B' }]);
    expect(asList([{ _id: 'c' }])).toEqual([{ _id: 'c', id: 'c' }]);
  });
});

describe('selected schema and why', () => {
  const dest = { location: { country: 'FR', zip_code: '75011' } };
  const schemas = buildSchemas(cfg('cfg_sdd'), dest, mockRoutes, ctx);

  it('matches a multi-leg schema when OneStock returns only one of its legs', () => {
    const shipments = shipmentsFromPromise(
      { delivery_method: 'SDD', status: 'valid', destination: dest, delivery_routes: [{ id: 'r_wh_hub_paris', carrier: { name: 'geodis', option: 'linehaul' } }] },
      mockRoutes,
      ctx,
    );
    const [idx] = matchShipmentsToSchemas(schemas, shipments);
    expect(ids(schemas[idx])).toBe('r_wh_hub_paris>r_hub_idf_sdd');
  });

  it('prefers the exact match', () => {
    const shipments = shipmentsFromPromise(
      { delivery_method: 'SDD', status: 'valid', destination: dest, delivery_routes: [{ id: 'r_stores_idf_sdd', carrier: { name: 'stuart', option: 'same_day' } }] },
      mockRoutes,
      ctx,
    );
    expect(ids(schemas[matchShipmentsToSchemas(schemas, shipments)[0]])).toBe('r_stores_idf_sdd');
  });

  it('checks the stock of the origin zone', () => {
    const stock = collectStockLines({ stocks: [{ endpoint_id: 'WH_TLS', item_id: 'P', quantity: 4, type: 'on_hand' }, { endpoint_id: 'ST_PARIS', item_id: 'P', quantity: 2, type: 'in_transit' }] });
    const fromStores = schemas.find((s) => ids(s) === 'r_stores_idf_sdd')!;
    const fromWh = schemas.find((s) => ids(s) === 'r_wh_hub_paris>r_hub_idf_sdd')!;
    expect(originAvailability(fromStores, [{ item_id: 'P', qty: 1 }], stock, ctx)[0].endpoints).toEqual([]);
    expect(originAvailability(fromWh, [{ item_id: 'P', qty: 1 }], stock, ctx)[0].endpoints).toEqual([{ id: 'WH_TLS', quantity: 4 }]);
  });
});

describe('priorities', () => {
  const dest = { location: { country: 'FR', zip_code: '75011' } };
  const schemas = buildSchemas(cfg('cfg_sdd'), dest, mockRoutes, ctx);
  const byIds = (k: string) => schemas.find((s) => ids(s) === k)!;

  it('finds the sort order of a method / channel', () => {
    expect(sortOrderFor(mockSortOrders, 'SDD', 'ecom_fr')?.id).toBe('so_sdd');
    expect(sortOrderFor(mockSortOrders, 'CKC', 'ecom_fr')).toBeUndefined();
  });

  it('gives the decisive criterion', () => {
    const order = { id: 'x', sort_criterias: [{ field: 'cost' }, { field: 'eta_end' }] };
    // hub route costs 1.2 + 9 = 10.2, store route 8: the store route wins on cost
    const d = decisiveCriterion(order, byIds('r_stores_idf_sdd'), byIds('r_wh_hub_paris>r_hub_idf_sdd'))!;
    expect(d).toMatchObject({ rank: 1, field: 'cost', chosenBetter: true });
    // the other way round: the "other" one looks better -> it must have been excluded
    expect(decisiveCriterion(order, byIds('r_wh_hub_paris>r_hub_idf_sdd'), byIds('r_stores_idf_sdd'))!.chosenBetter).toBe(false);
  });

  it('lists the restrictions of a route carrier', () => {
    const route = mockRoutes.find((r) => r.id === 'r_hub_idf_sdd')!;
    expect(restrictionsForRoute(route, mockRestrictions).map((r) => r.id)).toEqual(['res_bulky_courier']);
    expect(restrictionsForRoute(mockRoutes.find((r) => r.id === 'r_wh_fr_colissimo')!, mockRestrictions)).toEqual([]);
  });
});
