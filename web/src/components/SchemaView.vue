<script setup lang="ts">
import { OsAlert, OsBadge, OsButton, OsCardLayout, OsCollapse, OsDivider, OsIcon, OsTag } from '@onestock-public/design-system';
import {
  criterionKind,
  decisiveCriterion,
  formatHours,
  restrictionsForRoute,
  routeConstraints,
  bestByPriorities,
  prioritiesFor,
  matchShipmentsToSchemas,
  originAvailability,
  schemaCost,
  zoneEndpoints,
  type LogisticSchema,
  type OriginAvailability,
  type StockLine,
} from '@shared/logistics';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { formatDate, formatMoney, t } from '../i18n';
import { currency, destination, endpoints, itemLabel, runDebug, selectedSchemas, state, zoneCtx } from '../store';
import SchemaChain from './SchemaChain.vue';

const data = computed(() => selectedSchemas.value);
const option = computed(() => data.value?.entry.option);
const dest = computed(() => option.value?.destination ?? destination.value ?? {});
const units = computed(() => ({ hour: t('hour'), day: t('day') }));
const zoneName = (id: string) => zoneCtx.value.zones.get(id)?.name ?? id;
const endpointName = (id: string) => endpoints.value.find((e) => e.id === id)?.name ?? id;
const transit = (s: LogisticSchema) => formatHours(s.minHours, s.maxHours, units.value);

/* ------------------------------------------------------------------ priorities (GET /sort_orders) */

const priorities = computed(() => prioritiesFor(data.value?.entry.config, state.referential?.sort_orders ?? [], state.salesChannel));
const sortOrder = computed(() => priorities.value.order);
function criterionLabel(field: string): string {
  const f = field.toLowerCase();
  if (/eta_start/.test(f)) return t('critEtaStart');
  if (/eta|delay|time|date|lead|fast/.test(f)) return t('critEta');
  if (/carbon|co2|footprint/.test(f)) return t('critCarbon');
  if (/cost|price|fee/.test(f)) return t('critCost');
  if (/shipment|split/.test(f)) return t('critShipments');
  return field;
}
function criterionFormat(field: string, v: number): string {
  if (criterionKind(field) === 'time') return formatHours(v, v, units.value);
  if (/cost|price|fee/i.test(field)) return formatMoney(v, currency.value);
  return String(Math.round(v * 100) / 100);
}

/* ------------------------------------------------------------------ OneStock detailed computation (debug) */

const debugOpen = ref(false);
const debugState = ref<'idle' | 'loading' | 'error'>('idle');
const debugResult = ref<unknown>(null);
const debugError = ref('');
async function loadDebug() {
  if (!option.value) return;
  debugState.value = 'loading';
  debugError.value = '';
  try {
    debugResult.value = await runDebug(option.value.delivery_method);
    debugOpen.value = true;
    debugState.value = 'idle';
  } catch (e) {
    debugError.value = e instanceof Error ? e.message : String(e);
    debugState.value = 'error';
  }
}
watch(option, () => {
  debugResult.value = null;
  debugOpen.value = false;
  debugState.value = 'idle';
});

/* ------------------------------------------------------------------ stock at the origins (to explain the choice) */

const stock = ref<StockLine[] | null>(null);
const stockState = ref<'idle' | 'loading' | 'ok' | 'error'>('idle');

/** Lines to serve: the fulfillable ones when the promise is partial. */
const lines = computed(() =>
  option.value?.line_items?.length ? option.value.line_items : state.lines.map((l) => ({ item_id: l.item.id, qty: l.qty })),
);

watch(
  data,
  async (d) => {
    stock.value = null;
    if (!d || !d.theoretical.length) return (stockState.value = 'idle');
    const eps = [...new Set(d.theoretical.flatMap((s) => zoneEndpoints(zoneCtx.value.zones.get(s.originZoneId ?? ''), zoneCtx.value).map((e) => e.id)))];
    if (!eps.length) return (stockState.value = 'idle');
    stockState.value = 'loading';
    try {
      const res = await api.stocks(
        lines.value.map((l) => l.item_id),
        eps.slice(0, 200),
      );
      if (data.value === d) {
        stock.value = res.stocks;
        stockState.value = 'ok';
      }
    } catch {
      if (data.value === d) stockState.value = 'error';
    }
  },
  { immediate: true },
);

/* ------------------------------------------------------------------ chosen schema + reasons */

interface Reason {
  ok: boolean | null;
  text: string;
}
interface Row {
  schema: LogisticSchema;
  number: number;
  chosen: boolean;
  /** Best schema according to the configured priorities, among the ones holding the stock. */
  expected: boolean;
  /** Legs returned by OneStock for this schema (multi-leg chains may be partially returned). */
  returnedLegs: number;
  availability: OriginAvailability[] | null;
  cost?: number;
  reasons: Reason[];
}

const rows = computed<Row[]>(() => {
  const d = data.value;
  if (!d) return [];
  const matches = matchShipmentsToSchemas(d.theoretical, d.shipments);
  const base: Row[] = d.theoretical.map((schema, i) => ({
    schema,
    number: i + 1,
    chosen: matches.includes(i),
    expected: false,
    returnedLegs: d.shipments.filter((_, k) => matches[k] === i).reduce((n, s) => Math.max(n, s.legs.length), 0),
    availability: stock.value ? originAvailability(schema, lines.value, stock.value, zoneCtx.value) : null,
    cost: schemaCost(schema),
    reasons: [],
  }));
  const hasStock = (r: Row) => !r.availability || r.availability.every((a) => a.endpoints.length > 0);
  const order = sortOrder.value;
  const expectedIdx = bestByPriorities(order, base.map((r) => r.schema), (i) => hasStock(base[i]));
  if (expectedIdx >= 0) base[expectedIdx].expected = true;
  const expected = base[expectedIdx];
  const ref0 = base.find((r) => r.chosen);
  const fmt = (txt: string, d: { rank: number; field: string; chosen: number; other: number }) =>
    txt
      .replace('{rank}', String(d.rank))
      .replace('{label}', criterionLabel(d.field))
      .replace('{chosen}', criterionFormat(d.field, d.chosen))
      .replace('{other}', criterionFormat(d.field, d.other));

  for (const r of base) {
    const reasons: Reason[] = [];
    // Stock at the origin
    if (r.availability) {
      for (const a of r.availability) {
        if (a.endpoints.length) {
          const where = a.endpoints.map((e) => `${endpointName(e.id)} (${e.quantity})`).join(', ');
          reasons.push({ ok: true, text: t('whyStockAt').replace('{item}', `${itemLabel(a.item_id)} × ${a.qty}`).replace('{where}', where) });
        } else {
          reasons.push({ ok: false, text: t('whyNoStock').replace('{item}', `${itemLabel(a.item_id)} × ${a.qty}`).replace('{zone}', zoneName(r.schema.originZoneId ?? '')) });
        }
      }
    }
    if (r.chosen) {
      reasons.unshift({ ok: true, text: t('whyChosenByPromise') });
      if (r.returnedLegs && r.returnedLegs < r.schema.legs.length)
        reasons.push({ ok: null, text: t('whyPartialLegs').replace('{n}', String(r.returnedLegs)).replace('{m}', String(r.schema.legs.length)) });
      if (r.expected) reasons.push({ ok: true, text: t('whyMatchesPriorities') });
      else if (expected) {
        const d = decisiveCriterion(order, expected.schema, r.schema);
        reasons.push({
          ok: false,
          text: d ? fmt(t('whyPrioritiesPointElsewhere'), d).replaceAll('{n}', String(expected.number)) : t('whyPrioritiesTie').replace('{n}', String(expected.number)),
        });
      }
    } else if (r.expected && ref0) {
      const d = decisiveCriterion(order, ref0.schema, r.schema);
      reasons.unshift({ ok: null, text: t('whyExpectedNotChosen') });
      if (d && !d.chosenBetter) reasons.push({ ok: null, text: fmt(t('whyExpectedBetter'), d) });
      reasons.push({ ok: null, text: t('whyExpectedCauses') });
    } else if (r.expected) {
      reasons.unshift({ ok: true, text: t('whyExpectedOnly') });
    } else if (ref0 && hasStock(r)) {
      const d = decisiveCriterion(order, ref0.schema, r.schema);
      if (d?.chosenBetter) reasons.push({ ok: false, text: fmt(t('whyLostOnCriterion'), d) });
      else if (d) reasons.push({ ok: null, text: fmt(t('whyBetterButExcluded'), d) });
      else reasons.push({ ok: null, text: t('whyNotChosenOther') });
    } else if (expected && hasStock(r)) {
      const d = decisiveCriterion(order, expected.schema, r.schema);
      if (d?.chosenBetter) reasons.push({ ok: false, text: fmt(t('whyLostOnCriterion'), d) });
    }
    // Restrictions and constraints of the carriers used (possible exclusion causes, to check against the items).
    for (const leg of r.schema.legs) {
      const carrier = `${leg.route.carrier.name} · ${leg.route.carrier.option}`;
      for (const res of restrictionsForRoute(leg.route, state.referential?.delivery_restrictions ?? []))
        reasons.push({ ok: null, text: t('whyRestriction').replace('{carrier}', carrier).replace('{what}', res.description ?? res.id) });
      const constraints = routeConstraints(leg.route);
      if (constraints.length) reasons.push({ ok: null, text: t('whyConstraint').replace('{carrier}', carrier).replace('{what}', constraints.join(', ')) });
    }
    r.reasons = reasons;
  }
  // Chosen schema first, then the expected one, then the ones with stock, fastest first.
  return [...base].sort(
    (a, b) =>
      Number(b.chosen) - Number(a.chosen) ||
      Number(b.expected) - Number(a.expected) ||
      Number(hasStock(b)) - Number(hasStock(a)) ||
      a.schema.maxHours - b.schema.maxHours,
  );
});

const anyChosen = computed(() => rows.value.some((r) => r.chosen));
</script>

<template>
  <OsCardLayout v-if="data && option">
    <div class="schema">
      <header>
        <div class="title">
          <span class="os-title-m">{{ t('schema') }}</span>
          <span class="os-label-s os-text-secondary">{{ data.entry.config?.name ?? option.delivery_method }} · {{ option.delivery_method }}</span>
        </div>
        <div class="kpis" v-if="option.status !== 'none'">
          <div class="kpi">
            <span class="os-body-m os-text-secondary">{{ t('eta') }}</span>
            <span class="os-label-l">{{ formatDate(option.eta_end) }}</span>
          </div>
          <div v-if="option.cutoff" class="kpi">
            <span class="os-body-m os-text-secondary">{{ t('cutoff') }}</span>
            <span class="os-label-l">{{ formatDate(option.cutoff) }}</span>
          </div>
          <div v-if="option.cost !== undefined" class="kpi">
            <span class="os-body-m os-text-secondary">{{ t('cost') }}</span>
            <span class="os-label-l">{{ formatMoney(option.cost, currency) }}</span>
          </div>
        </div>
      </header>

      <OsAlert
        v-if="option.status === 'none'"
        type="danger"
        :title="t('status_none')"
        :subtitle="option.reason ? `${t(`reason_${option.reason}`)} (${option.reason})` : undefined"
      />
      <OsAlert
        v-if="option.excluded_line_items?.length"
        type="warning"
        :title="t('excludedItems')"
        :subtitle="option.excluded_line_items.map((l) => `${itemLabel(l.item_id)} × ${l.qty}`).join(', ')"
      />

      <OsDivider />

      <section class="block">
        <div class="section-head">
          <span class="os-label-l">{{ t('schemaTheoretical') }}</span>
          <span class="os-body-s os-text-secondary">{{ t('schemaTheoreticalHint') }}</span>
        </div>
        <div v-if="data.entry.config" class="config os-body-s">
          <span class="os-text-secondary">{{ t('carrier') }} :</span>
          <OsTag v-for="c in data.entry.config.carriers ?? []" :key="`${c.name}-${c.option}`" :text="`${c.name} · ${c.option}`" readonly color="grey" />
          <span class="os-text-secondary">{{ t('zones') }} :</span>
          <OsTag v-for="z in data.entry.config.delivery_zone_ids ?? []" :key="z" :text="zoneName(z)" readonly color="blue" />
        </div>
        <div class="priorities">
          <span class="os-body-l">{{ t('prioritiesTitle') }}</span>
          <ol class="os-body-s">
            <li v-for="(c, k) in sortOrder.sort_criterias ?? []" :key="k">
              <strong>{{ criterionLabel(c.field) }}</strong>
              <span class="os-text-secondary"> ({{ c.field }}, {{ c.desc ? t('critDesc') : t('critAsc') }})</span>
            </li>
          </ol>
          <span class="os-body-s os-text-secondary">
            {{ priorities.isDefault ? t('prioritiesDefault') : t('prioritiesSource').replace('{source}', priorities.source) }}
          </span>
          <span class="os-body-s os-text-secondary">{{ t('prioritiesHint') }}</span>
        </div>
        <OsAlert v-if="option.status !== 'none' && data.theoretical.length && !anyChosen" type="info" :subtitle="t('whyNoRoutesReturned')" />
        <p v-if="!data.theoretical.length" class="os-label-s os-text-secondary">{{ t('noSchema') }}</p>

        <div v-for="row in rows" :key="row.number" class="theo" :class="{ used: row.chosen, expected: row.expected && !row.chosen }">
          <div class="theo-head os-body-s os-text-secondary">
            <span>#{{ row.number }} · {{ row.schema.legs.length }} {{ row.schema.legs.length > 1 ? t('legs') : t('leg') }} · {{ t('transit') }} {{ transit(row.schema) }}</span>
            <span class="badges">
              <OsBadge v-if="row.expected" :text="t('schemaExpected')" color="blue" icon="star" />
              <OsBadge v-if="row.chosen" :text="t('schemaSelected')" color="green" icon="check" />
            </span>
          </div>
          <SchemaChain :legs="row.schema.legs" :destination="dest" compact />
          <ul v-if="row.reasons.length" class="reasons">
            <li v-for="(r, k) in row.reasons" :key="k" class="os-body-s" :class="r.ok === true ? 'ok' : r.ok === false ? 'ko' : 'info'">
              <OsIcon :icon="r.ok === true ? 'check-circle-outline' : r.ok === false ? 'close-circle-outline' : 'info-outline'" size="xs" />
              <span>{{ r.text }}</span>
            </li>
          </ul>
          <p v-else-if="stockState === 'loading'" class="os-body-s os-text-secondary reasons">{{ t('whyLoading') }}</p>
        </div>
        <p v-if="stockState === 'error'" class="os-body-s os-text-secondary">{{ t('whyStockUnavailable') }}</p>
      </section>

      <OsDivider />
      <section class="block">
        <div class="debug-head">
          <div class="section-head">
            <span class="os-label-l">{{ t('debugTitle') }}</span>
            <span class="os-body-s os-text-secondary">{{ t('debugHint') }}</span>
          </div>
          <OsButton type="secondary" icon="search" :text="t('debugRun')" :pending="debugState === 'loading'" @click="loadDebug" />
        </div>
        <OsAlert v-if="debugState === 'error'" type="danger" :subtitle="debugError" />
        <OsCollapse v-if="debugResult" v-model="debugOpen">
          <template #header><span class="os-body-l">{{ t('debugResult') }}</span></template>
          <template #content><pre class="raw">{{ JSON.stringify(debugResult, null, 2) }}</pre></template>
        </OsCollapse>
      </section>
    </div>
  </OsCardLayout>
</template>

<style scoped>
.schema { display: flex; flex-direction: column; gap: 16px; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; }
.title { display: flex; flex-direction: column; gap: 2px; }
.title .os-title-m { color: var(--os-text-primary); }
.kpis { display: flex; gap: 24px; flex-wrap: wrap; }
.kpi { display: flex; flex-direction: column; gap: 2px; }
.kpi .os-label-l { color: var(--os-text-primary); }
.block { display: flex; flex-direction: column; gap: 10px; }
.section-head { display: flex; flex-direction: column; gap: 2px; }
.section-head .os-label-l { color: var(--os-text-primary); }
.config { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.theo { border: 1px dashed var(--os-border); border-radius: 5px; padding: 8px 10px; }
.theo.used { border: 1px solid var(--os-green-1000); background: var(--os-green-t-100); --chain-bg: #ecf5ec; }
.theo.expected { border: 1px solid var(--os-blue-1000); background: var(--os-blue-t-100); --chain-bg: #eaf4fe; }
.badges { display: inline-flex; gap: 6px; }
.theo-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.reasons { list-style: none; margin: 6px 0 0; padding: 8px 0 0; border-top: 1px solid var(--os-border); display: flex; flex-direction: column; gap: 4px; }
.reasons li { display: flex; align-items: flex-start; gap: 6px; color: var(--os-text-primary); }
.reasons li :deep(.os-icon) { margin-top: 1px; }
.reasons .ok :deep(.os-icon) { color: var(--os-green-1000); }
.reasons .ko { color: var(--os-neutral-700); }
.reasons .ko :deep(.os-icon) { color: var(--os-red-1000); }
.reasons .info :deep(.os-icon) { color: var(--os-blue-1000); }
.priorities { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 5px; background: var(--os-neutral-t-30); }
.priorities .os-body-l { color: var(--os-text-primary); }
.priorities ol { margin: 0; padding-left: 20px; color: var(--os-text-primary); }
.debug-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.raw { margin: 0; max-height: 420px; overflow: auto; background: var(--os-neutral-30); border: 1px solid var(--os-border); border-radius: 5px; padding: 12px; font-size: 12px; }
</style>
