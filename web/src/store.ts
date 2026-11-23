import type { ExecutionTime, Timetable } from '@shared/timetables';
import { deliveryMethods, isClickAndCollect, zoneEndpoints, type StockLine, type ZoneContext } from '@shared/logistics';
import { candidateEndpoints, computePromise, stockRequestOf, type CapacityLookup, type CapacityQuery, type LocalPromiseOption } from '@shared/promise';
import type { DeliveryConfig, Destination, Endpoint, Item } from '@shared/types';
import { computed, markRaw, reactive, toRaw, watch } from 'vue';
import { api, type Referential } from './api';
import { lang } from './i18n';

export type DestinationType = 'address' | 'zone' | 'endpoint';

export interface ResultEntry {
  option: LocalPromiseOption;
  config?: DeliveryConfig;
}

export const state = reactive({
  referential: null as Referential | null,
  extraEndpoints: [] as Endpoint[],
  lines: [] as { item: Item; qty: number }[],
  salesChannel: '' as string,
  destType: 'address' as DestinationType,
  address: { country: '', zip_code: '', state: '', timezone: '' },
  zoneId: '',
  endpointId: '',
  price: { enabled: false, value: undefined as number | undefined },
  methods: { enabled: false, values: [] as string[] },
  date: { enabled: false, value: '' },
  /** Deliver in a minimum of parcels (consolidation at an intermediate point). */
  consolidation: false,
  running: false,
  error: null as unknown,
  results: null as ResultEntry[] | null,
  selected: -1,
  /** Durations of the last test (stock, capacities, computation). */
  stats: null as null | {
    stock_ms: number;
    capacity_ms: number;
    capacity_rounds: number;
    capacity_queries: number;
    capacity_calls: number;
    compute_ms: number;
    total_ms: number;
  },
});

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
function dayFormatter(tz = 'Europe/Paris') {
  let f = dayFormatters.get(tz);
  if (!f) dayFormatters.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz })));
  return f;
}

/* ---------------------------------------------------------------- display options (Configuration tab) */

const DISPLAY_KEY = 'dpm.display';
function readDisplay() {
  try {
    return JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? '{}') as Partial<typeof defaults>;
  } catch {
    return {};
  }
}
const defaults = { loadReport: false, config: false, consolidation: false, timeline: false, reasons: false };
/** What the delivery promise panel shows: hidden by default, enabled from the Configuration tab. */
export const display = reactive({ ...defaults, ...readDisplay() });
watch(display, (v) => {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
});

export const endpoints = computed<Endpoint[]>(() => {
  const map = new Map<string, Endpoint>();
  for (const e of [...(state.referential?.endpoints ?? []), ...state.extraEndpoints]) map.set(e.id, { ...map.get(e.id), ...e });
  return [...map.values()];
});

export const zoneCtx = computed<ZoneContext>(() => ({
  zones: new Map((state.referential?.zones ?? []).map((z) => [z.id, z])),
  endpoints: new Map(endpoints.value.map((e) => [e.id, e])),
}));

export const salesChannels = computed(() => {
  const ref = state.referential;
  if (!ref) return [];
  const list = new Map(ref.sales_channels.map((s) => [s.id, s]));
  for (const c of ref.delivery_configs) if (c.sales_channel_id && !list.has(c.sales_channel_id)) list.set(c.sales_channel_id, { id: c.sales_channel_id });
  return [...list.values()];
});

export const currency = computed(() => salesChannels.value.find((s) => s.id === state.salesChannel)?.currency ?? 'EUR');

export const channelMethods = computed(() => deliveryMethods(state.referential?.delivery_configs ?? [], state.salesChannel || undefined));

export const destination = computed<Destination | null>(() => {
  if (state.destType === 'zone') return state.zoneId ? { delivery_zone: state.zoneId } : null;
  if (state.destType === 'endpoint') return state.endpointId ? { endpoint_id: state.endpointId } : null;
  const a = state.address;
  if (!a.country) return null;
  const location: Record<string, string> = { country: a.country };
  if (a.zip_code.trim()) location.zip_code = a.zip_code.trim();
  if (a.state.trim()) location.state = a.state.trim();
  if (a.timezone) location.timezone = a.timezone;
  return { location };
});

export const canRun = computed(() => !!state.salesChannel && state.lines.length > 0 && !!destination.value && !state.running);

export function addLine(item: Item, qty = 1) {
  const existing = state.lines.find((l) => l.item.id === item.id);
  if (existing) existing.qty += qty;
  else state.lines.push({ item, qty });
}

export async function loadReferential(refresh = false) {
  // markRaw: large data read by the computation, never mutated (replaced as a whole): no reactive proxies.
  state.referential = markRaw(await api.referential(refresh));
  if (!state.salesChannel && salesChannels.value.length) state.salesChannel = salesChannels.value[0].id;
}

export async function loadEndpoints(query = '') {
  const { endpoints: found } = await api.searchEndpoints(query);
  state.extraEndpoints = [...state.extraEndpoints.filter((e) => !found.some((f) => f.id === e.id)), ...found.map((e) => markRaw(e))];
}

/** Maps of the referential, built once per load (the computation memoizes calendars per map). */
const refMapsMemo = new WeakMap<Referential, { timetablesMap: Map<string, Timetable>; executionTimesMap: Map<string, ExecutionTime> }>();
function refMaps(ref: Referential) {
  let m = refMapsMemo.get(ref);
  if (!m) {
    m = {
      timetablesMap: new Map((ref.timetables ?? []).map((tt) => [tt.id, tt])),
      executionTimesMap: new Map((ref.execution_times ?? []).map((e) => [e.id, e])),
    };
    refMapsMemo.set(ref, m);
  }
  return m;
}

/**
 * Click & collect: collection store chosen in the result of a method (method -> endpoint id). The promise of that
 * method is computed again with this store as destination.
 */
export const pickupStores = reactive<Record<string, string>>({});

/** Stores where a click & collect method can deliver: stock locations of its delivery zones. */
export function pickupStoresFor(config: DeliveryConfig | undefined): Endpoint[] {
  if (!config) return [];
  const ctx = zoneCtx.value;
  const seen = new Map<string, Endpoint>();
  for (const z of config.delivery_zone_ids ?? []) for (const e of zoneEndpoints(ctx.zones.get(z), ctx)) if (!seen.has(e.id)) seen.set(e.id, ctx.endpoints.get(e.id) ?? e);
  const loc = state.destType === 'address' && state.address.country ? state.address : undefined;
  const byName = (a: Endpoint, b: Endpoint) => (a.name ?? a.id).localeCompare(b.name ?? b.id);
  if (!loc) return [...seen.values()].sort(byName);
  // nearest first: same country, then the longest common zip code prefix, then the closest zip code
  const score = (e: Endpoint) => {
    const country = e.address?.regions?.country?.code?.toUpperCase();
    const zip = (e.address?.zip_code ?? '').replace(/\s/g, '');
    const target = loc.zip_code.replace(/\s/g, '');
    let prefix = 0;
    while (prefix < zip.length && prefix < target.length && zip[prefix] === target[prefix]) prefix++;
    const gap = /^\d+$/.test(zip) && /^\d+$/.test(target) ? Math.abs(Number(zip) - Number(target)) : Number.MAX_SAFE_INTEGER;
    return [country && country !== loc.country.toUpperCase() ? 1 : 0, -prefix, gap];
  };
  const scores = new Map([...seen.values()].map((e) => [e.id, score(e)]));
  return [...seen.values()].sort((a, b) => {
    const x = scores.get(a.id)!;
    const y = scores.get(b.id)!;
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || byName(a, b);
  });
}

/** Click & collect configuration of a method in the selected sales channel. */
function clickCollectConfig(method: string): DeliveryConfig | undefined {
  const c = (state.referential?.delivery_configs ?? []).find(
    (x) => x.delivery_method === method && (!x.sales_channel_id || x.sales_channel_id === state.salesChannel),
  );
  return c && isClickAndCollect(c) ? c : undefined;
}

/** Compute again one click & collect method for the chosen store (empty = the destination of the form). */
export async function refinePickupStore(method: string, endpointId: string) {
  if (endpointId) pickupStores[method] = endpointId;
  else delete pickupStores[method];
  if (!destination.value) return;
  await runTest({ method, destination: endpointId ? { endpoint_id: endpointId } : destination.value });
}

export async function runTest(only?: { method: string; destination: Destination }) {
  if (!canRun.value || !destination.value || !state.referential) return;
  if (!only) for (const k of Object.keys(pickupStores)) delete pickupStores[k];
  state.running = true;
  state.error = null;
  if (!only) state.selected = -1;
  try {
    const ref = state.referential;
    const dest = only?.destination ?? destination.value;
    const methods = only ? [only.method] : state.methods.enabled && state.methods.values.length ? state.methods.values : channelMethods.value.map((c) => c.delivery_method);
    const lines = state.lines.map((l) => ({ item_id: l.item.id, qty: l.qty }));
    // Click & collect towards an address: computed by default for the nearest collection store (changeable in the result).
    const groups: { methods: string[]; destination: Destination }[] = [];
    const rest: string[] = [];
    for (const m of methods) {
      const cfg = !only && state.destType === 'address' ? clickCollectConfig(m) : undefined;
      const nearest = cfg ? pickupStoresFor(cfg)[0] : undefined;
      if (nearest) {
        pickupStores[m] = nearest.id;
        groups.push({ methods: [m], destination: { endpoint_id: nearest.id } });
      } else rest.push(m);
    }
    if (rest.length) groups.unshift({ methods: rest, destination: dest });
    const from = state.date.enabled && state.date.value ? Math.floor(new Date(state.date.value).getTime() / 1000) : Math.floor(Date.now() / 1000);
    const common = {
      salesChannel: state.salesChannel,
      destination: dest,
      methods,
      configs: ref.delivery_configs,
      routes: ref.delivery_routes,
      ctx: zoneCtx.value,
      sortOrders: ref.sort_orders ?? [],
      restrictions: ref.delivery_restrictions ?? [],
    };

    const t0 = performance.now();
    // Items added before their physical data were loaded: reload them (weight / dimensions for the constraints),
    // in parallel with the stock.
    const missing = state.lines.filter((l) => l.item.weight === undefined).map((l) => l.item.id);
    const itemsReload = missing.length
      ? api
          .itemsByIds(missing, lang.value)
          .then(({ items: fresh }) => {
            for (const f of fresh) {
              const line = state.lines.find((l) => l.item.id === f.id);
              if (line) line.item = { ...line.item, ...f, image: line.item.image ?? f.image };
            }
          })
          .catch((e) => console.warn('[dpmultileg] items reload failed', e))
      : Promise.resolve();

    // Stock of every stock location that may serve the order: one call per stock request of the delivery methods
    // (delivery_configs.stock_request), all in parallel.
    const eps = [...new Set(groups.flatMap((g) => [...candidateEndpoints({ ...common, ...g }), ...(g.destination.endpoint_id ? [g.destination.endpoint_id] : [])]))];
    const requests = [
      ...new Set(
        ref.delivery_configs
          .filter((c) => methods.includes(c.delivery_method) && (!c.sales_channel_id || c.sales_channel_id === state.salesChannel))
          .map((c) => stockRequestOf(c)),
      ),
    ];
    const stocks: Record<string, StockLine[] | null> = {};
    await Promise.all([
      itemsReload,
      ...(requests.length ? requests : [stockRequestOf(undefined)]).map(async (name) => {
        try {
          stocks[name] = (
            await api.stocks(
              lines.map((l) => l.item_id),
              eps,
              name,
            )
          ).stocks;
        } catch (e) {
          console.warn(`[dpmultileg] stock (${name}) unavailable, availability not verified`, e);
          stocks[name] = null;
        }
      }),
    ]);
    const t1 = performance.now();
    const stock = Object.values(stocks)[0] ?? null;

    // Capacities (GET /capacities) are read for the stock locations / days the computation actually considers:
    // compute, fetch the capMissing days, compute again (a full day postpones to the next one, which may be capMissing).
    const capDays = new Map<string, { date: number; until: number; remaining: number; capacity?: number }[]>();
    const capFailed = new Set<string>();
    const capKey = (q: CapacityQuery) => (q.kind === 'carrier' ? `${q.endpoint}|${q.carrier}` : q.endpoint);
    let capMissing = new Map<string, CapacityQuery>();
    const capacity: CapacityLookup = (q) => {
      const key = capKey(q);
      if (capFailed.has(key)) return undefined;
      const hit = capDays.get(key)?.find((d) => d.date <= q.at && q.at < d.until);
      if (hit) return hit;
      const day = dayFormatter(q.timezone).format(new Date(q.at * 1000));
      capMissing.set(`${key}|${day}`, q);
      return undefined;
    };
    let computeMs = 0;
    let capMs = 0;
    let capCalls = 0;
    let capQueries = 0;
    let rounds = 0;
    // built once: the computation memoizes per map (calendars of the routes...) across the capacity rounds
    const itemsMap = new Map(state.lines.map((l) => [l.item.id, toRaw(l.item)]));
    const { timetablesMap, executionTimesMap } = refMaps(ref);
    const compute = () => {
      const c0 = performance.now();
      const run = (g: { methods: string[]; destination: Destination }) => computePromise({
        ...common,
        ...g,
        lines,
        from,
        items: itemsMap,
        stock,
        stocks,
        price: state.price.enabled ? state.price.value : undefined,
        timetables: timetablesMap,
        events: ref.scheduled_events ?? [],
        executionTimes: executionTimesMap,
        settings: ref.settings,
        consolidate: state.consolidation,
        capacity,
      });
      // results in the order of the methods
      const all = groups.flatMap(run);
      const r = methods.flatMap((m) => all.filter((o) => o.delivery_method === m));
      computeMs += performance.now() - c0;
      return r;
    };
    let computed = compute();
    // A full day sends the computation to the next day: the following days are fetched with it (7 at a time) until
    // the engine no longer asks for an unknown day.
    const known = (key: string, at: number) => capFailed.has(key) || !!capDays.get(key)?.some((d) => d.date <= at && at < d.until);
    for (let round = 0; round < 30 && capMissing.size; round++) {
      const queries = [...capMissing.values()];
      capMissing = new Map();
      for (let i = 0; i < queries.length; i += 200) {
        const batch = queries.slice(i, i + 200);
        try {
          const k0 = performance.now();
          rounds++;
          capQueries += batch.length;
          const { results, calls } = await api.capacities(batch.map((q) => ({ endpoint: q.endpoint, carrier: q.carrier, at: q.at, timezone: q.timezone })));
          capMs += performance.now() - k0;
          capCalls += calls ?? batch.length;
          batch.forEach((q, k) => {
            const r = results[k];
            const key = capKey(q);
            if (!r?.ok) return capFailed.add(key);
            const date = r.date ?? q.at - (q.at % 86400);
            const list = capDays.get(key) ?? [];
            if (!list.some((d) => d.date === date)) list.push({ date, until: date + 86400, remaining: r.remaining ?? Infinity, capacity: r.capacity ?? undefined });
            capDays.set(key, list);
            // day full: look at the next days at once
            if ((r.remaining ?? Infinity) < q.needed)
              for (let n = 1; n <= 7; n++) {
                const at = date + n * 86400 + 43200;
                if (!known(key, at)) capacity({ ...q, at });
              }
          });
        } catch (e) {
          console.warn('[dpmultileg] capacities unavailable', e);
          for (const q of batch) capFailed.add(capKey(q));
        }
      }
      // fetch the prefetched days before computing again
      if (capMissing.size && [...capMissing.values()].every((q) => queries.some((x) => capKey(x) === capKey(q)))) continue;
      computed = compute();
    }
    if (capMissing.size) computed = compute();

    const options = computed;
    state.stats = {
      stock_ms: Math.round(t1 - t0),
      capacity_ms: Math.round(capMs),
      capacity_rounds: rounds,
      capacity_queries: capQueries,
      capacity_calls: capCalls,
      compute_ms: Math.round(computeMs),
      total_ms: Math.round(performance.now() - t0),
    };
    console.info('[dpmultileg] promise timings', state.stats);
    const entries = options.map((option) => markRaw({ option, config: option.config }));
    if (only && state.results) {
      // replace the result of this method only, at the same place
      const idx = state.results.findIndex((r) => r.option.delivery_method === only.method);
      if (idx >= 0 && entries[0]) {
        state.results.splice(idx, 1, entries[0]);
        state.selected = idx;
      }
    } else {
      state.results = entries;
      const firstOk = state.results.findIndex((r) => r.option.status !== 'none');
      state.selected = firstOk >= 0 ? firstOk : state.results.length ? 0 : -1;
    }
  } catch (e) {
    state.error = e;
    if (!only) state.results = null;
  } finally {
    state.running = false;
  }
}

/** Selected delivery option, computed locally. */
export const selectedSchemas = computed(() => {
  const entry = state.results?.[state.selected];
  if (!entry || !state.referential) return null;
  return { entry, analysis: entry.option.analysis };
});

export function itemLabel(id: string): string {
  return state.lines.find((l) => l.item.id === id)?.item.name ?? id;
}

export { lang };
