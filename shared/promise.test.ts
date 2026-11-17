import { describe, expect, it } from 'vitest';
import { mockConfigs, mockEndpoints, mockItems, mockRestrictions, mockRoutes, mockSortOrders, mockZones } from '../server/src/mock.js';
import type { ZoneContext } from './logistics.js';
import { computePromise, operationsHours, parseDurationHours, type PromiseInput } from './promise.js';
import type { Destination, Item } from './types.js';

const ctx: ZoneContext = { zones: new Map(mockZones.map((z) => [z.id, z])), endpoints: new Map(mockEndpoints.map((e) => [e.id, e])) };
// Items as returned by /api/items/search (attributes = features of the language)
const items = new Map<string, Item>(mockItems.map((i) => [i.id, { ...i, attributes: i.features?.fr }]));
const stock = [
  ...mockItems.filter((i) => i.id !== 'WATCH_STEEL_SV').map((i) => ({ endpoint_id: 'WH_TLS', item_id: i.id, quantity: 50, type: 'on_hand' })),
  { endpoint_id: 'ST_PARIS', item_id: 'SCARF_WOOL_RD', quantity: 4, type: 'on_hand' },
  { endpoint_id: 'ST_PARIS', item_id: 'WATCH_STEEL_SV', quantity: 1, type: 'on_hand' },
  { endpoint_id: 'ST_LYON', item_id: 'WATCH_STEEL_SV', quantity: 2, type: 'on_hand' },
];
const paris: Destination = { location: { country: 'FR', zip_code: '75011' } };
const from = 1_800_000_000;

function run(method: string, lines: [string, number][], destination: Destination = paris, extra: Partial<PromiseInput> = {}) {
  return computePromise({
    salesChannel: 'ecom_fr',
    lines: lines.map(([item_id, qty]) => ({ item_id, qty })),
    destination,
    methods: [method],
    from,
    configs: mockConfigs,
    routes: mockRoutes,
    ctx,
    sortOrders: mockSortOrders,
    restrictions: mockRestrictions,
    items,
    stock,
    ...extra,
  })[0];
}
const used = (o: ReturnType<typeof run>) => (o.delivery_routes ?? []).map((r) => r.id);

describe('local delivery promise', () => {
  it('serves from the stores when they hold the stock (fastest)', () => {
    const o = run('SDD', [['SCARF_WOOL_RD', 1]]);
    expect(o.status).toBe('valid');
    expect(used(o)).toEqual(['r_stores_idf_sdd']);
    expect(o.delivery_routes![0].origin_endpoint_id).toBe('ST_PARIS');
    // now + 1h of operations + 3h of transit
    expect(o.eta_end).toBe(from + 4 * 3600);
  });

  it('goes through the warehouse and the hub when the stores have no stock (multi-leg)', () => {
    const o = run('SDD', [['PARKA_WINTER_KK_M', 1]]);
    expect(used(o)).toEqual(['r_wh_hub_paris', 'r_hub_idf_sdd']);
    const storeSchema = o.analysis.find((a) => a.schema.legs.map((l) => l.route.id).join() === 'r_stores_idf_sdd')!;
    expect(storeSchema.exclusions.map((e) => e.kind)).toEqual(['no_stock']);
  });

  it('applies carrier restrictions and parcel constraints', () => {
    const o = run('SDD', [['SOFA_3P_GR', 1]]);
    expect(o.status).toBe('none');
    const kinds = new Set(o.analysis.flatMap((a) => a.exclusions.map((e) => e.kind)));
    expect(kinds.has('restriction')).toBe(true);
    expect(kinds.has('constraint')).toBe(true);
  });

  it('ranks with the configured priorities (cost first for home delivery)', () => {
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]]);
    expect(used(o)).toEqual(['r_wh_fr_colissimo']);
    expect(o.cost).toBe(6.5);
  });

  it('splits within the authorized number of shipments', () => {
    const hd = run('HD_standard', [
      ['WATCH_STEEL_SV', 1],
      ['PARKA_WINTER_KK_M', 1],
    ]);
    expect(hd).toMatchObject({ status: 'valid', shipment_number: 2 });
    const sdd = run('SDD', [
      ['WATCH_STEEL_SV', 1],
      ['PARKA_WINTER_KK_M', 1],
    ]);
    expect(sdd.status).toBe('partial');
    expect(sdd.shipment_number).toBe(1);
    expect(sdd.excluded_line_items).toHaveLength(1);
  });

  it('serves a click & collect from the collection store stock', () => {
    const o = run('CKC', [['SCARF_WOOL_RD', 1]], { endpoint_id: 'ST_PARIS' });
    expect(o).toMatchObject({ status: 'valid', local_pickup: true, delivery_routes: [] });
  });

  it('reports missing configurations and unknown items', () => {
    expect(run('SDD', [['SCARF_WOOL_RD', 1]], { location: { country: 'FR', zip_code: '31000' } }).reason).toBe('missing_config');
    expect(run('SDD', [['NOPE', 1]]).reason).toBe('invalid_item');
  });

  it('assumes stock when it can not be read', () => {
    const o = run('SDD', [['PARKA_WINTER_KK_M', 1]], paris, { stock: null });
    expect(o.stock_unverified).toBe(true);
    expect(used(o)).toEqual(['r_stores_idf_sdd']);
  });
});

describe('durations', () => {
  it('parses execution times', () => {
    expect(parseDurationHours('2h')).toBe(2);
    expect(parseDurationHours('1d 2h')).toBe(26);
    expect(parseDurationHours('PT1H30M')).toBe(1.5);
    expect(parseDurationHours('00:45')).toBe(0.75);
    expect(parseDurationHours(90)).toBe(1.5);
    expect(operationsHours(mockConfigs.find((c) => c.id === 'cfg_sdd')!)).toBe(1);
  });
});
