<script setup lang="ts">
import { OsAlert, OsBadge, OsCardLayout, OsDivider, OsIcon, OsTag } from '@onestock-public/design-system';
import {
  formatHours,
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
import { currency, destination, endpoints, itemLabel, selectedSchemas, state, zoneCtx } from '../store';
import SchemaChain from './SchemaChain.vue';

const data = computed(() => selectedSchemas.value);
const option = computed(() => data.value?.entry.option);
const dest = computed(() => option.value?.destination ?? destination.value ?? {});
const units = computed(() => ({ hour: t('hour'), day: t('day') }));
const zoneName = (id: string) => zoneCtx.value.zones.get(id)?.name ?? id;
const endpointName = (id: string) => endpoints.value.find((e) => e.id === id)?.name ?? id;
const transit = (s: LogisticSchema) => formatHours(s.minHours, s.maxHours, units.value);

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
    returnedLegs: d.shipments.filter((_, k) => matches[k] === i).reduce((n, s) => Math.max(n, s.legs.length), 0),
    availability: stock.value ? originAvailability(schema, lines.value, stock.value, zoneCtx.value) : null,
    cost: schemaCost(schema),
    reasons: [],
  }));
  const hasStock = (r: Row) => !r.availability || r.availability.every((a) => a.endpoints.length > 0);
  const chosen = base.filter((r) => r.chosen);
  const ref0 = chosen[0];
  const stocked = base.filter(hasStock);
  const fastest = Math.min(...stocked.map((r) => r.schema.maxHours));
  const cheapest = Math.min(...stocked.map((r) => r.cost ?? Infinity));

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
      if (hasStock(r) && stocked.length > 1) {
        if (r.schema.maxHours <= fastest) reasons.push({ ok: true, text: t('whyFastest') });
        else if (r.cost !== undefined && r.cost <= cheapest) reasons.push({ ok: true, text: t('whyCheapest') });
        else {
          const faster = stocked.find((o) => !o.chosen && o.schema.maxHours < r.schema.maxHours);
          if (faster) reasons.push({ ok: null, text: t('whyFasterExists').replace('{n}', String(faster.number)) });
        }
      }
    } else if (ref0) {
      if (!hasStock(r)) {
        /* the stock reason is already given */
      } else if (r.schema.maxHours > ref0.schema.maxHours) {
        reasons.push({ ok: false, text: t('whySlower').replace('{a}', transit(r.schema)).replace('{b}', transit(ref0.schema)) });
      } else if (r.cost !== undefined && ref0.cost !== undefined && r.cost > ref0.cost) {
        reasons.push({ ok: false, text: t('whyMoreExpensive').replace('{a}', formatMoney(r.cost, currency.value)).replace('{b}', formatMoney(ref0.cost, currency.value)) });
      } else {
        reasons.push({ ok: null, text: t('whyNotChosenOther') });
      }
    }
    r.reasons = reasons;
  }
  // Chosen schema first, then the ones with stock, fastest first.
  return [...base].sort((a, b) => Number(b.chosen) - Number(a.chosen) || Number(hasStock(b)) - Number(hasStock(a)) || a.schema.maxHours - b.schema.maxHours);
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
        <OsAlert v-if="option.status !== 'none' && data.theoretical.length && !anyChosen" type="info" :subtitle="t('whyNoRoutesReturned')" />
        <p v-if="!data.theoretical.length" class="os-label-s os-text-secondary">{{ t('noSchema') }}</p>

        <div v-for="row in rows" :key="row.number" class="theo" :class="{ used: row.chosen }">
          <div class="theo-head os-body-s os-text-secondary">
            <span>#{{ row.number }} · {{ row.schema.legs.length }} {{ row.schema.legs.length > 1 ? t('legs') : t('leg') }} · {{ t('transit') }} {{ transit(row.schema) }}</span>
            <OsBadge v-if="row.chosen" :text="t('schemaSelected')" color="green" icon="check" />
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
.theo-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.reasons { list-style: none; margin: 6px 0 0; padding: 8px 0 0; border-top: 1px solid var(--os-border); display: flex; flex-direction: column; gap: 4px; }
.reasons li { display: flex; align-items: flex-start; gap: 6px; color: var(--os-text-primary); }
.reasons li :deep(.os-icon) { margin-top: 1px; }
.reasons .ok :deep(.os-icon) { color: var(--os-green-1000); }
.reasons .ko { color: var(--os-neutral-700); }
.reasons .ko :deep(.os-icon) { color: var(--os-red-1000); }
.reasons .info :deep(.os-icon) { color: var(--os-blue-1000); }
</style>
