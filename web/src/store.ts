import { buildSchemas, deliveryMethods, shipmentsFromPromise, type ZoneContext } from '@shared/logistics';
import type { DeliveryConfig, Destination, Endpoint, Item, PromiseOption } from '@shared/types';
import { computed, reactive } from 'vue';
import { api, type Referential } from './api';
import { lang } from './i18n';

export type DestinationType = 'address' | 'zone' | 'endpoint';

export interface ResultEntry {
  option: PromiseOption;
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
  exchange: null as { request: unknown; response: unknown } | null,
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

/** Same request as the test, for one delivery method, with OneStock debug details (sort order, restrictions...). */
export async function runDebug(deliveryMethod: string): Promise<unknown> {
  if (!destination.value) return null;
  const body: Record<string, unknown> = {
    sales_channel: state.salesChannel,
    line_items: state.lines.map((l) => ({ item_id: l.item.id, qty: l.qty })),
    delivery_options: [{ delivery_method: deliveryMethod, destination: destination.value }],
    debug: true,
  };
  if (state.price.enabled && state.price.value !== undefined) body.price = state.price.value;
  if (state.date.enabled && state.date.value) body.from = Math.floor(new Date(state.date.value).getTime() / 1000);
  return (await api.deliveryPromises(body)).response;
}

export async function runTest() {
  if (!canRun.value || !destination.value) return;
  state.running = true;
  state.error = null;
  state.selected = -1;
  try {
    const methods = state.methods.enabled && state.methods.values.length ? state.methods.values : channelMethods.value.map((c) => c.delivery_method);
    const body: Record<string, unknown> = {
      sales_channel: state.salesChannel,
      line_items: state.lines.map((l) => ({ item_id: l.item.id, qty: l.qty })),
    };
    if (state.price.enabled && state.price.value !== undefined) body.price = state.price.value;
    if (state.date.enabled && state.date.value) body.from = Math.floor(new Date(state.date.value).getTime() / 1000);

    // OneStock recommends at most 10 delivery options per call.
    const chunks: string[][] = [];
    for (let i = 0; i < methods.length; i += 10) chunks.push(methods.slice(i, i + 10));
    const responses = await Promise.all(
      chunks.map((chunk) => api.deliveryPromises({ ...body, delivery_options: chunk.map((m) => ({ delivery_method: m, destination: destination.value })) })),
    );
    const options = responses.flatMap((r) => r.response?.delivery_options ?? []);
    const configs = state.referential?.delivery_configs ?? [];
    state.results = options.map((option) => ({
      option: { ...option, destination: option.destination ?? destination.value ?? undefined },
      config: deliveryMethods(configs, state.salesChannel).find((c) => c.delivery_method === option.delivery_method),
    }));
    state.exchange = responses.length === 1 ? responses[0] : { request: responses.map((r) => r.request), response: responses.map((r) => r.response) };
    const firstOk = state.results.findIndex((r) => r.option.status !== 'none');
    state.selected = firstOk >= 0 ? firstOk : state.results.length ? 0 : -1;
  } catch (e) {
    state.error = e;
    state.results = null;
  } finally {
    state.running = false;
  }
}


/** Schema(s) for the selected result: actual routes when returned by the API, theoretical ones from the configuration. */
export const selectedSchemas = computed(() => {
  const entry = state.results?.[state.selected];
  if (!entry || !state.referential) return null;
  const routes = state.referential.delivery_routes;
  const dest = entry.option.destination ?? destination.value ?? {};
  return {
    entry,
    shipments: shipmentsFromPromise(entry.option, routes, zoneCtx.value),
    theoretical: buildSchemas(entry.config, dest, routes, zoneCtx.value, { maxLegs: 3, limit: 12 }),
  };
});

export function itemLabel(id: string): string {
  return state.lines.find((l) => l.item.id === id)?.item.name ?? id;
}

export { lang };
