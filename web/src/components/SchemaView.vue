<script setup lang="ts">
/**
 * Logistic schema of the selected delivery option, as computed locally (shared/promise.ts):
 * selected schema(s), then the other possible schemas with the reason they were not selected.
 */
import { OsAlert, OsBadge, OsCardLayout, OsCollapse, OsDivider, OsIcon, OsTag } from '@onestock-public/design-system';
import { criterionKind, formatHours, prioritiesFor, type LogisticSchema } from '@shared/logistics';
import { decisiveBetween, type SchemaAnalysis } from '@shared/promise';
import { computed, ref } from 'vue';
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
const configOpen = ref(false);

/* ------------------------------------------------------------------ priorities */

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
  if (criterionKind(field) === 'time') return v > 1e9 ? formatDate(v) : formatHours(v, v, units.value);
  if (/cost|price|fee/i.test(field)) return formatMoney(v, currency.value);
  return String(Math.round(v * 100) / 100);
}

/* ------------------------------------------------------------------ rows */

interface Reason {
  ok: boolean | null;
  text: string;
}
interface Row {
  a: SchemaAnalysis;
  number: number;
  selected: boolean;
  reasons: Reason[];
}

const rows = computed<Row[]>(() => {
  const o = option.value;
  if (!o) return [];
  const analysis = o.analysis ?? [];
  const selectedRef = analysis.find((a) => a.shipment === 0);
  const first = sortOrder.value.sort_criterias?.[0];
  return analysis.map((a, i) => {
    const reasons: Reason[] = [];
    const selected = a.shipment >= 0;
    if (selected) {
      reasons.push({ ok: true, text: t('whySelectedByPriorities').replace('{label}', first ? criterionLabel(first.field) : '') });
      for (const sh of a.shipments)
        reasons.push({
          ok: true,
          text: t('whyShipmentCarries')
            .replace('{n}', String(sh.index + 1))
            .replace('{items}', sh.lines.map((l) => `${itemLabel(l.item_id)} × ${l.qty}`).join(', '))
            .replace('{where}', endpointName(sh.endpoint)),
        });
    }
    // For a selected schema, only the lines it carries are relevant.
    const carried = selected ? new Set(a.shipments.flatMap((sh) => sh.lines.map((l) => l.item_id))) : undefined;
    for (const s of a.stock.filter((x) => !carried || carried.has(x.item_id))) {
      for (const e of a.exclusions.filter((x) => x.item_id === s.item_id && x.kind !== 'no_stock'))
        reasons.push({
          ok: false,
          text: t(e.kind === 'restriction' ? 'whyRestricted' : e.kind === 'timetable' ? 'whyNoSlot' : 'whyConstraintFailed')
            .replace('{item}', itemLabel(s.item_id))
            .replace('{what}', e.text),
        });
      if (o.stock_unverified) continue;
      if (s.endpoints.length) {
        const where = s.endpoints.map((e) => `${endpointName(e.id)} (${e.quantity})`).join(', ');
        reasons.push({ ok: true, text: t('whyStockAt').replace('{item}', `${itemLabel(s.item_id)} × ${s.qty}`).replace('{where}', where) });
      } else {
        reasons.push({ ok: false, text: t('whyNoStock').replace('{item}', `${itemLabel(s.item_id)} × ${s.qty}`).replace('{zone}', zoneName(a.schema.originZoneId ?? '')) });
      }
    }
    if (!selected && selectedRef && !a.exclusions.length) {
      const d = decisiveBetween(sortOrder.value, selectedRef, a);
      if (d?.chosenBetter)
        reasons.push({
          ok: false,
          text: t('whyLostOnCriterion')
            .replace('{rank}', String(d.rank))
            .replace('{label}', criterionLabel(d.field))
            .replace('{chosen}', criterionFormat(d.field, d.chosen))
            .replace('{other}', criterionFormat(d.field, d.other)),
        });
      else reasons.push({ ok: null, text: t('whyTieWithSelected') });
    }
    return { a, number: i + 1, selected, reasons };
  });
});

const sortedRows = computed(() => [...rows.value].sort((x, y) => Number(y.selected) - Number(x.selected) || x.number - y.number));

/** Leg by leg timing with the carrier timetables. */
function timelineLines(a: SchemaAnalysis): string[] {
  return (a.timeline ?? []).map((tl, k) => {
    const leg = a.schema.legs[k]?.route;
    const carrier = leg ? `${leg.carrier.name} · ${leg.carrier.option}` : tl.route_id;
    const parts: string[] = [];
    if (tl.pickup) parts.push(t('tlPickup').replace('{at}', formatDate(tl.departure)).replace('{cutoff}', formatDate(tl.pickup.end)));
    else parts.push(t('tlDeparture').replace('{at}', formatDate(tl.departure)));
    parts.push(t('tlArrival').replace('{at}', formatDate(tl.arrival)) + (tl.transit_timetable ? ` (${tl.transit_timetable})` : ''));
    if (tl.slot) parts.push(t('tlSlot').replace('{from}', formatDate(tl.slot.start)).replace('{to}', formatDate(tl.slot.end)));
    return `${carrier} : ${parts.join(' → ')}`;
  });
}

/** Legs of a schema with the promise route of the first leg (to highlight the shipping stock location). */
function chainLegs(a: SchemaAnalysis) {
  return a.schema.legs.map((l, k) => ({
    ...l,
    promise: k === 0 && a.shipments.length ? { origin_endpoint_id: a.shipments[0].endpoint } : undefined,
  }));
}
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
          <div v-if="option.shipment_number" class="kpi">
            <span class="os-body-m os-text-secondary">{{ t('shipments') }}</span>
            <span class="os-label-l">{{ option.shipment_number }}</span>
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
      <OsAlert v-if="option.local_pickup" type="success" :subtitle="t('localPickup')" />
      <OsAlert v-if="option.stock_unverified" type="warning" :subtitle="t('stockUnverified')" />
      <p class="os-body-s os-text-secondary method">
        {{ t('localComputation').replace('{ops}', formatHours(option.operations_hours, option.operations_hours, units)) }}
      </p>

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
        </div>
        <p v-if="!rows.length" class="os-label-s os-text-secondary">{{ t('noSchema') }}</p>

        <div v-for="row in sortedRows" :key="row.number" class="theo" :class="{ used: row.selected }">
          <div class="theo-head os-body-s os-text-secondary">
            <span>
              #{{ row.number }} · {{ row.a.schema.legs.length }} {{ row.a.schema.legs.length > 1 ? t('legs') : t('leg') }} · {{ t('transit') }}
              {{ transit(row.a.schema) }} · {{ t('eta') }} {{ formatDate(row.a.eta_end) }}
            </span>
            <span class="badges">
              <OsBadge
                v-for="sh in (option.shipment_number ?? 1) > 1 ? row.a.shipments : []"
                :key="sh.index"
                :text="`${t('shipment')} ${sh.index + 1}`"
                color="blue"
                type="secondary"
              />
              <OsBadge v-if="row.selected" :text="t('schemaSelected')" color="green" icon="check" />
            </span>
          </div>
          <SchemaChain :legs="chainLegs(row.a)" :destination="dest" compact />
          <ul v-if="row.a.timeline?.length" class="timeline os-body-s">
            <li v-for="(line, k) in timelineLines(row.a)" :key="k"><OsIcon icon="time" size="xs" /> <span>{{ line }}</span></li>
          </ul>
          <ul v-if="row.reasons.length" class="reasons">
            <li v-for="(r, k) in row.reasons" :key="k" class="os-body-s" :class="r.ok === true ? 'ok' : r.ok === false ? 'ko' : 'info'">
              <OsIcon :icon="r.ok === true ? 'check-circle-outline' : r.ok === false ? 'close-circle-outline' : 'info-outline'" size="xs" />
              <span>{{ r.text }}</span>
            </li>
          </ul>
        </div>
      </section>

      <OsCollapse v-if="data.entry.config" v-model="configOpen">
        <template #header><span class="os-body-l">{{ t('configRaw') }}</span></template>
        <template #content><pre class="raw">{{ JSON.stringify(data.entry.config, null, 2) }}</pre></template>
      </OsCollapse>
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
.method { margin: 0; }
.block { display: flex; flex-direction: column; gap: 10px; }
.section-head { display: flex; flex-direction: column; gap: 2px; }
.section-head .os-label-l { color: var(--os-text-primary); }
.config { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.priorities { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 5px; background: var(--os-neutral-t-30); }
.priorities .os-body-l { color: var(--os-text-primary); }
.priorities ol { margin: 0; padding-left: 20px; color: var(--os-text-primary); }
.theo { border: 1px dashed var(--os-border); border-radius: 5px; padding: 8px 10px; }
.theo.used { border: 1px solid var(--os-green-1000); background: var(--os-green-t-100); --chain-bg: #ecf5ec; }
.theo-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.badges { display: inline-flex; gap: 6px; }
.reasons { list-style: none; margin: 6px 0 0; padding: 8px 0 0; border-top: 1px solid var(--os-border); display: flex; flex-direction: column; gap: 4px; }
.reasons li { display: flex; align-items: flex-start; gap: 6px; color: var(--os-text-primary); }
.reasons li :deep(.os-icon) { margin-top: 1px; }
.reasons .ok :deep(.os-icon) { color: var(--os-green-1000); }
.reasons .ko { color: var(--os-neutral-700); }
.reasons .ko :deep(.os-icon) { color: var(--os-red-1000); }
.reasons .info :deep(.os-icon) { color: var(--os-blue-1000); }
.timeline { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; color: var(--os-neutral-700); }
.timeline li { display: flex; gap: 6px; align-items: flex-start; }
.timeline li :deep(.os-icon) { margin-top: 1px; color: var(--os-neutral-500); }
.raw { margin: 0; max-height: 420px; overflow: auto; background: var(--os-neutral-30); border: 1px solid var(--os-border); border-radius: 5px; padding: 12px; font-size: 12px; }
</style>
