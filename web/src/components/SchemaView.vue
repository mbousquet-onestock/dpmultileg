<script setup lang="ts">
import { OsAlert, OsBadge, OsCardLayout, OsCollapse, OsDivider, OsIcon, OsTag } from '@onestock-public/design-system';
import { formatHours } from '@shared/logistics';
import { computed, ref, watch } from 'vue';
import { formatDate, formatMoney, t } from '../i18n';
import { currency, destination, itemLabel, selectedSchemas, state, zoneCtx } from '../store';
import SchemaChain from './SchemaChain.vue';

const showTheoretical = ref(false);
const showRaw = ref(false);

const data = computed(() => selectedSchemas.value);
const option = computed(() => data.value?.entry.option);
const dest = computed(() => option.value?.destination ?? destination.value ?? {});
const usedKeys = computed(() => new Set((data.value?.shipments ?? []).map((s) => s.legs.map((l) => l.route?.id).join('>'))));
const units = computed(() => ({ hour: t('hour'), day: t('day') }));

watch(
  () => state.selected,
  () => {
    showTheoretical.value = !!data.value && data.value.shipments.length === 0;
  },
  { immediate: true },
);

const zoneName = (id: string) => zoneCtx.value.zones.get(id)?.name ?? id;
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

      <!-- Schema actually used by the delivery promise -->
      <section v-if="data.shipments.length" class="block">
        <span class="os-label-l block-title"><OsIcon icon="route" size="s" color="brand" /> {{ t('schemaUsed') }}</span>
        <div v-for="(shipment, i) in data.shipments" :key="i" class="shipment">
          <div class="shipment-head">
            <OsBadge :text="`${t('shipment')} ${i + 1}`" color="blue" type="secondary" />
            <OsBadge v-if="shipment.legs.length > 1" :text="`${shipment.legs.length} ${t('legs')}`" color="purple" />
            <span v-if="shipment.items.length" class="os-label-s">
              {{ shipment.items.map((it) => `${itemLabel(it.id)} × ${it.quantity}`).join(', ') }}
            </span>
            <span v-if="shipment.eta_end" class="os-label-s os-text-secondary eta">≤ {{ formatDate(shipment.eta_end) }}</span>
          </div>
          <SchemaChain :legs="shipment.legs" :destination="dest" />
        </div>
      </section>
      <OsAlert v-else-if="option.status !== 'none'" type="info" :subtitle="t('schemaNoRoutes')" />

      <OsDivider />

      <!-- Theoretical schemas from configuration -->
      <OsCollapse v-model="showTheoretical">
        <template #header>
          <div class="collapse-head">
            <span class="os-label-l">{{ t('schemaTheoretical') }} ({{ data.theoretical.length }})</span>
            <span class="os-body-s os-text-secondary">{{ t('schemaTheoreticalHint') }}</span>
          </div>
        </template>
        <template #content>
          <div class="theoretical">
            <div v-if="data.entry.config" class="config os-body-s">
              <span class="os-text-secondary">{{ t('carrier') }} :</span>
              <OsTag v-for="c in data.entry.config.carriers ?? []" :key="`${c.name}-${c.option}`" :text="`${c.name} · ${c.option}`" readonly color="grey" />
              <span class="os-text-secondary">{{ t('zones') }} :</span>
              <OsTag v-for="z in data.entry.config.delivery_zone_ids ?? []" :key="z" :text="zoneName(z)" readonly color="blue" />
            </div>
            <p v-if="!data.theoretical.length" class="os-label-s os-text-secondary">{{ t('noSchema') }}</p>
            <div
              v-for="(s, i) in data.theoretical"
              :key="i"
              class="theo"
              :class="{ used: usedKeys.has(s.legs.map((l) => l.route.id).join('>')) }"
            >
              <div class="theo-head os-body-s os-text-secondary">
                <span>#{{ i + 1 }} · {{ s.legs.length }} {{ s.legs.length > 1 ? t('legs') : t('leg') }} · {{ t('transit') }} {{ formatHours(s.minHours, s.maxHours, units) }}</span>
                <OsBadge v-if="usedKeys.has(s.legs.map((l) => l.route.id).join('>'))" :text="t('schemaUsed')" color="green" icon="check" />
              </div>
              <SchemaChain :legs="s.legs" :destination="dest" compact />
            </div>
          </div>
        </template>
      </OsCollapse>

      <OsDivider />

      <OsCollapse v-model="showRaw">
        <template #header><span class="os-label-l">{{ t('rawExchange') }}</span></template>
        <template #content>
          <pre class="raw">{{ JSON.stringify(state.exchange, null, 2) }}</pre>
        </template>
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
.block { display: flex; flex-direction: column; gap: 12px; }
.block-title { display: inline-flex; align-items: center; gap: 6px; color: var(--os-text-primary); }
.shipment { border: 1px solid var(--os-border); border-radius: 5px; padding: 12px; display: flex; flex-direction: column; gap: 12px; background: var(--os-neutral-20); --chain-bg: var(--os-neutral-20); }
.shipment-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.eta { margin-left: auto; }
.collapse-head { display: flex; flex-direction: column; gap: 2px; }
.collapse-head .os-label-l { color: var(--os-text-primary); }
.theoretical { display: flex; flex-direction: column; gap: 10px; }
.config { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.theo { border: 1px dashed var(--os-border); border-radius: 5px; padding: 8px 10px; }
.theo.used { border: 1px solid var(--os-green-1000); background: var(--os-green-t-100); --chain-bg: #ecf5ec; }
.theo-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.raw { margin: 0; max-height: 420px; overflow: auto; background: var(--os-neutral-30); border: 1px solid var(--os-border); border-radius: 5px; padding: 12px; font-size: 12px; }
</style>
