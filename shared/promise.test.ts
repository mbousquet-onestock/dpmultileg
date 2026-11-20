import { describe, expect, it } from 'vitest';
import { mockConfigs, mockEndpoints, mockExecutionTimes, mockItems, mockRestrictions, mockRoutes, mockSortOrders, mockTimetables, mockZones } from '../server/src/mock.js';
import type { ZoneContext } from './logistics.js';
import { computePromise, parseDurationHours, type PromiseInput } from './promise.js';
import type { Destination, Item } from './types.js';

const ctx: ZoneContext = { zones: new Map(mockZones.map((z) => [z.id, z])), endpoints: new Map(mockEndpoints.map((e) => [e.id, e])) };
// Items as returned by /api/items/search (attributes = features of the language)
// Items as returned by /api/items/search: features of the language + item fields (weight)
const items = new Map<string, Item>(mockItems.map((i) => [i.id, { ...i, attributes: { ...i.features?.fr, ...(i.weight !== undefined ? { weight: [i.weight] } : {}) } }]));
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
    executionTimes: new Map(mockExecutionTimes.map((e) => [e.id, e])),
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

describe('with carrier timetables', () => {
  const FRIDAY_18H = 1795194000; // Friday 20 Nov 2026 18:00 Europe/Paris
  const timetables = new Map(mockTimetables.map((t) => [t.id, t]));

  it('uses the pickup cutoff, the transit days and the end of the delivery slot', () => {
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, { from: FRIDAY_18H, timetables });
    const monday16 = FRIDAY_18H + (2 * 24 + 22) * 3600;
    expect(used(o)).toEqual(['r_wh_fr_colissimo']);
    expect(o.eta_start).toBe(monday16 + 24 * 3600);
    expect(o.eta_end).toBe(monday16 + 74 * 3600);
    // 30 min of validation + 1h of preparation, on the France timetable (Mon-Fri 9h-18h), before the 17:00 cutoff
    expect(o.cutoff).toBe(monday16 + 3600 - 1.5 * 3600);
    expect(o.analysis[0].operations?.map((op) => [op.operation, op.start - FRIDAY_18H])).toEqual([
      ['validation', (2 * 24 + 15) * 3600], // Monday 09:00
      ['pick_pack', (2 * 24 + 15.5) * 3600], // Monday 09:30
    ]);
    expect(o.analysis[0].timeline?.[0].pickup?.name).toContain('Colissimo');
  });

  it('ranks the fastest schema on the real date, not only the transit time', () => {
    const o = run('SDD', [['SCARF_WOOL_RD', 1]], paris, { from: FRIDAY_18H, timetables });
    expect(used(o)).toEqual(['r_stores_idf_sdd']);
    // preparation (1h) only on the France timetable: Monday 09:00-10:00, courier pickup 10:00, 1h-3h of transit,
    // delivered in the Monday 10h-21h slot: 11:00 at the earliest, end of slot (21:00) at the latest
    const monday = FRIDAY_18H + (2 * 24 + 6) * 3600; // Monday 00:00
    expect(o.eta_start).toBe(monday + 11 * 3600);
    expect(o.eta_end).toBe(monday + 21 * 3600);
  });

  it('times operations on the execution timetable, or else on the stock location opening hours', () => {
    const noTimetable = run('SDD', [['SCARF_WOOL_RD', 1]], paris, { from: FRIDAY_18H, timetables, executionTimes: new Map() });
    // execution time not readable (e.g. GET /execution_times not allowed): duration 0, flagged as unknown
    expect(noTimetable.analysis[0].operations?.[0]).toMatchObject({ operation: 'pick_pack', hours: 0, unknown: true });
  });
});

describe('priorities from the extension settings', () => {
  // Parka to Paris: warehouse + colissimo = 6.50 € (24h-72h), Toulouse store + colissimo = 6.90 € (24h-48h)
  const withStore = [...stock, { endpoint_id: 'ST_TLS', item_id: 'PARKA_WINTER_KK_M', quantity: 1, type: 'on_hand' }];
  it('the cheapest, then the fastest', () => {
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, { stock: withStore, settings: { priorities: { HD_standard: 'cheapest_then_fastest' } } });
    expect(used(o)).toEqual(['r_wh_fr_colissimo']);
  });
  it('the fastest', () => {
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, { stock: withStore, settings: { priorities: { HD_standard: 'fastest' } } });
    expect(used(o)).toEqual(['r_stores_fr_colissimo']);
  });
});

describe('shipping fees', () => {
  it('estimated cost = shipping fees, transportation cost = cost by parcel, summed per shipment', () => {
    const one = run('HD_standard', [['PARKA_WINTER_KK_M', 1]]);
    expect(one).toMatchObject({ cost: 6.5, shipping_fees: 4.99 });
    const two = run('HD_standard', [
      ['WATCH_STEEL_SV', 1],
      ['PARKA_WINTER_KK_M', 1],
    ]);
    expect(two.shipment_number).toBe(2);
    expect(two.shipping_fees).toBe(9.98);
  });
});

describe('consolidation', () => {
  const both: [string, number][] = [
    ['WATCH_STEEL_SV', 1],
    ['PARKA_WINTER_KK_M', 1],
  ];
  it('groups the items at an intermediate point after a transfer: one shipment', () => {
    const normal = run('HD_standard', both);
    expect(normal.shipment_number).toBe(2);
    const o = run('HD_standard', both, paris, { consolidate: true });
    expect(o.status).toBe('valid');
    expect(o.shipment_number).toBe(1);
    const c = o.consolidation!;
    // the point holds the watch, the parka is transferred to it
    expect(['ST_PARIS', 'ST_LYON']).toContain(c.point);
    expect(c.local.map((l) => l.item_id)).toEqual(['WATCH_STEEL_SV']);
    expect(c.transfers.map((tr) => tr.item_id)).toEqual(['PARKA_WINTER_KK_M']);
    // the final shipment leaves once the transfer has arrived
    expect(c.ready).toBeGreaterThanOrEqual(c.transfers[0].arrival);
    expect(o.delivery_routes!.filter((r) => r.transfer).length).toBeGreaterThan(0);
  });

  it('applies the capacities to the transfer', () => {
    const base = run('HD_standard', both, paris, { consolidate: true });
    const from = base.consolidation!.transfers[0].from;
    let first = 0;
    const o = run('HD_standard', both, paris, {
      consolidate: true,
      capacity: (q) => {
        if (q.kind !== 'preparation' || q.endpoint !== from) return undefined;
        if (!first) first = q.at - (q.at % 86400);
        return { remaining: q.at < first + 2 * 86400 ? 0 : 5, until: q.at - (q.at % 86400) + 86400 };
      },
    });
    expect(o.capacity_delays?.some((d) => d.transfer && d.endpoint === from)).toBe(true);
    expect(o.consolidation!.transfers[0].arrival).toBeGreaterThan(base.consolidation!.transfers[0].arrival);
  });

  it('respects the delivery method: same day delivery (1 shipment allowed) becomes complete', () => {
    expect(run('SDD', both).status).toBe('partial');
    const o = run('SDD', both, paris, { consolidate: true });
    expect(o).toMatchObject({ status: 'valid', shipment_number: 1 });
    // last leg with a carrier of the method
    expect(o.consolidation!.analysis.schema.legs.at(-1)!.route.carrier.name).toBe('stuart');
  });

  it('only uses routes of the delivery method (every leg, transfers included)', () => {
    const config = mockConfigs.find((c) => c.id === 'cfg_hd_std')!;
    const allowed = (name: string, option: string) => config.carriers!.some((c) => c.name === name && c.option === option);
    const o = run('HD_standard', both, paris, { consolidate: true });
    for (const a of o.analysis) for (const l of a.schema.legs) expect(allowed(l.route.carrier.name, l.route.carrier.option)).toBe(true);
    for (const tr of o.consolidation!.transfers) for (const l of tr.schema.legs) expect(allowed(l.route.carrier.name, l.route.carrier.option)).toBe(true);
    // without the shuttles in the method, the transfer can not use them (it uses another carrier of the method)
    const restricted = mockConfigs.map((c) => (c.id === 'cfg_hd_std' ? { ...c, carriers: c.carriers!.filter((x) => x.name !== 'store_shuttle') } : c));
    const other = run('HD_standard', both, paris, { consolidate: true, configs: restricted });
    for (const tr of other.consolidation?.transfers ?? []) for (const l of tr.schema.legs) expect(l.route.carrier.name).not.toBe('store_shuttle');
  });

  it('keeps the normal allocation when one shipment is already enough', () => {
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, { consolidate: true });
    expect(o.consolidation).toBeUndefined();
    expect(o.shipment_number).toBe(1);
  });
});

describe('identical schemas', () => {
  it('shows once the schemas with the same carriers and zones (the orchestrator picks the location)', () => {
    const twin = { ...mockRoutes.find((r) => r.id === 'r_wh_fr_colissimo')!, id: 'r_wh_fr_colissimo_bis', metric_values: { cost_by_parcel: 9 } };
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, { routes: [...mockRoutes, twin] });
    const keys = o.analysis.map((a) => a.schema.legs.map((l) => `${l.route.carrier.name}|${l.route.origin_zone_id}|${l.route.destination_zone_id}`).join('>'));
    expect(new Set(keys).size).toBe(keys.length);
    // the cheapest twin is kept (priorities of the method: cost first)
    expect(used(o)).toEqual(['r_wh_fr_colissimo']);
  });
});

describe('durations', () => {
  it('parses execution times', () => {
    expect(parseDurationHours('2h')).toBe(2);
    expect(parseDurationHours('1d 2h')).toBe(26);
    expect(parseDurationHours('PT1H30M')).toBe(1.5);
    expect(parseDurationHours('00:45')).toBe(0.75);
    expect(parseDurationHours(90)).toBe(1.5);
  });
});

describe('future stock (ASN)', () => {
  const asn = { endpoint_id: 'WH_TLS', item_id: 'WATCH_STEEL_SV', quantity: 10, type: 'asn', eta_start: from + 3 * 86400, eta_end: from + 5 * 86400, purchase_order_number: 'PO_001' };

  it('serves a quantity missing on hand once the future stock has arrived', () => {
    const now = run('HD_standard', [['WATCH_STEEL_SV', 5]]);
    expect(now.status).toBe('none');
    const later = run('HD_standard', [['WATCH_STEEL_SV', 5]], paris, { stock: [...stock, asn] });
    expect(later.status).not.toBe('none');
    expect(later.future_stock?.[0]).toMatchObject({ endpoint_id: 'WH_TLS', quantity: 10, purchase_order_number: 'PO_001' });
    // delivered after the arrival window
    expect(later.eta_start!).toBeGreaterThan(asn.eta_start);
    expect(later.eta_end!).toBeGreaterThan(asn.eta_end);
  });

  it('reads the stock of the stock request of the delivery method', () => {
    // HD_standard has no stock_request: the default request "detailed" is used
    expect(run('HD_standard', [['WATCH_STEEL_SV', 5]], paris, { stocks: { detailed_ois: [...stock, asn] } }).status).toBe('none');
    expect(run('HD_standard', [['WATCH_STEEL_SV', 5]], paris, { stocks: { detailed: [...stock, asn] } }).status).not.toBe('none');
    const cfg = mockConfigs.map((c) => (c.delivery_method === 'HD_standard' ? { ...c, stock_request: 'detailed_ois' } : c));
    expect(run('HD_standard', [['WATCH_STEEL_SV', 5]], paris, { configs: cfg, stocks: { detailed: stock, detailed_ois: [...stock, asn] } }).status).not.toBe('none');
  });

  it('prefers the stock on hand to the future stock', () => {
    const o = run('HD_standard', [['WATCH_STEEL_SV', 1]], paris, { stock: [...stock, asn] });
    expect(o.future_stock).toBeUndefined();
    expect(o.eta_end!).toBeLessThan(asn.eta_end);
  });
});

describe('capacities', () => {
  const DAY = 86400;
  const dayOf = (t: number) => t - (t % DAY);
  it('postpones the preparation when the stock location capacity of the day is reached', () => {
    const base = run('HD_standard', [['PARKA_WINTER_KK_M', 1]]);
    const shipFrom = base.delivery_routes![0].origin_endpoint_id!;
    const firstDay = dayOf(from);
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, {
      capacity: (q) => (q.kind === 'preparation' && q.endpoint === shipFrom ? { remaining: dayOf(q.at) <= firstDay + DAY ? 0 : 10, until: dayOf(q.at) + DAY } : undefined),
    });
    expect(o.capacity_delays?.[0]).toMatchObject({ kind: 'preparation', endpoint: shipFrom, remaining: 0, needed: 1 });
    expect(o.eta_end!).toBeGreaterThan(base.eta_end!);
  });

  it('postpones the pickup when the carrier is full at the stock location', () => {
    const base = run('HD_standard', [['PARKA_WINTER_KK_M', 1]]);
    let full = 0;
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, {
      capacity: (q) => {
        if (q.kind !== 'carrier') return undefined;
        if (full === 0) full = dayOf(q.at);
        return { remaining: dayOf(q.at) === full ? 0 : 5, until: dayOf(q.at) + DAY };
      },
    });
    expect(o.capacity_delays?.some((d) => d.kind === 'carrier')).toBe(true);
    expect(o.eta_end!).toBeGreaterThan(base.eta_end!);
  });

  it('looks day after day until a day with capacity left', () => {
    let first = 0;
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, {
      capacity: (q) => {
        if (q.kind !== 'preparation') return undefined;
        if (!first) first = dayOf(q.at);
        return { remaining: dayOf(q.at) < first + 10 * DAY ? 0 : 3, until: dayOf(q.at) + DAY };
      },
    });
    expect(o.status).not.toBe('none');
    expect(o.capacity_delays!.filter((d) => d.kind === 'preparation').length).toBeGreaterThanOrEqual(10);
    expect(o.eta_start!).toBeGreaterThan(first + 10 * DAY);
  });

  it('applies the preparation capacity of the store to the click & collect', () => {
    const base = run('CKC', [['SCARF_WOOL_RD', 1]], { endpoint_id: 'ST_PARIS' });
    const o = run('CKC', [['SCARF_WOOL_RD', 1]], { endpoint_id: 'ST_PARIS' }, {
      capacity: (q) => (q.kind === 'preparation' && q.endpoint === 'ST_PARIS' ? { remaining: dayOf(q.at) <= dayOf(base.eta_end!) + DAY ? 0 : 4, until: dayOf(q.at) + DAY } : undefined),
    });
    expect(o.local_pickup).toBe(true);
    expect(o.capacity_delays?.[0]).toMatchObject({ kind: 'preparation', endpoint: 'ST_PARIS' });
    expect(o.eta_end!).toBeGreaterThan(dayOf(base.eta_end!) + 2 * DAY - 1);
  });

  it('ignores unknown capacities', () => {
    const base = run('HD_standard', [['PARKA_WINTER_KK_M', 1]]);
    const o = run('HD_standard', [['PARKA_WINTER_KK_M', 1]], paris, { capacity: () => undefined });
    expect(o.eta_end).toBe(base.eta_end);
    expect(o.capacity_delays).toBeUndefined();
  });
});

describe('click & collect with part of the items in the store', () => {
  it('serves the items in stock in the collection store and ships only the others', () => {
    // ST_PARIS holds the scarf, not the parka (warehouse)
    const o = run('CKC', [['SCARF_WOOL_RD', 1], ['PARKA_WINTER_KK_M', 1]], { endpoint_id: 'ST_PARIS' });
    expect(o.status).toBe('valid');
    expect(o.local_lines?.map((l) => l.item_id)).toEqual(['SCARF_WOOL_RD']);
    const shipped = (o.delivery_routes ?? []).flatMap((r) => r.items.map((i) => i.id));
    expect(shipped).toContain('PARKA_WINTER_KK_M');
    expect(shipped).not.toContain('SCARF_WOOL_RD');
    expect(o.shipment_number).toBe(2);
    expect(o.eta_end!).toBeGreaterThanOrEqual(o.local_ready!);
  });
});
