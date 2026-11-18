import { deliveryMethods, type StockLine, type ZoneContext } from '@shared/logistics';
import { candidateEndpoints, computePromise, type LocalPromiseOption } from '@shared/promise';
import type { DeliveryConfig, Destination, Endpoint, Item } from '@shared/types';
import { computed, reactive } from 'vue';
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
  running: false,
  error: null as unknown,
  results: null as ResultEntry[] | null,
  selected: -1,
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

export async function loadReferential() {
  state.referential = await api.referential();
  if (!state.salesChannel && salesChannels.value.length) state.salesChannel = salesChannels.value[0].id;
}

export async function loadEndpoints(query = '') {
  const { endpoints: found } = await api.searchEndpoints(query);
  state.extraEndpoints = [...state.extraEndpoints.filter((e) => !found.some((f) => f.id === e.id)), ...found];
}

export async function runTest() {
  if (!canRun.value || !destination.value || !state.referential) return;
  state.running = true;
  state.error = null;
  state.selected = -1;
  try {
    const ref = state.referential;
    const dest = destination.value;
    const methods = state.methods.enabled && state.methods.values.length ? state.methods.values : channelMethods.value.map((c) => c.delivery_method);
    const lines = state.lines.map((l) => ({ item_id: l.item.id, qty: l.qty }));
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

    // Stock of every stock location that may serve the order (GET /stocks, by chunks).
    const eps = candidateEndpoints(common);
    let stock: StockLine[] | null = [];
    try {
      for (let i = 0; i < eps.length; i += 400) {
        const res = await api.stocks(
          lines.map((l) => l.item_id),
          eps.slice(i, i + 400),
        );
        stock.push(...res.stocks);
      }
    } catch (e) {
      console.warn('[dpmultileg] stock unavailable, availability not verified', e);
      stock = null;
    }

    const options = computePromise({
      ...common,
      lines,
      from,
      items: new Map(state.lines.map((l) => [l.item.id, l.item])),
      stock,
      price: state.price.enabled ? state.price.value : undefined,
      timetables: new Map((ref.timetables ?? []).map((tt) => [tt.id, tt])),
      events: ref.scheduled_events ?? [],
    });
    state.results = options.map((option) => ({ option, config: option.config }));
    const firstOk = state.results.findIndex((r) => r.option.status !== 'none');
    state.selected = firstOk >= 0 ? firstOk : state.results.length ? 0 : -1;
  } catch (e) {
    state.error = e;
    state.results = null;
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
