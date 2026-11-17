<script setup lang="ts">
import { OsBadge, OsIcon, OsPicto } from '@onestock-public/design-system';
import { shipmentsFromPromise, isClickAndCollect } from '@shared/logistics';
import type { PromiseOption } from '@shared/types';
import { formatDate, formatMoney, t } from '../i18n';
import { currency, state, zoneCtx } from '../store';

function statusColor(o: PromiseOption) {
  if (o.status.startsWith('valid')) return 'green';
  if (o.status.startsWith('partial')) return 'orange';
  return 'red';
}

function legsCount(o: PromiseOption): number {
  if (!state.referential) return 0;
  const shipments = shipmentsFromPromise(o, state.referential.delivery_routes, zoneCtx.value);
  return Math.max(0, ...shipments.map((s) => s.legs.length));
}
</script>

<template>
  <div class="results">
    <button
      v-for="(entry, idx) in state.results ?? []"
      :key="`${entry.option.delivery_method}-${idx}`"
      type="button"
      class="result"
      :class="{ selected: state.selected === idx, none: entry.option.status === 'none' }"
      @click="state.selected = idx"
    >
      <OsPicto :icon="isClickAndCollect(entry.config) ? 'store' : 'truck'" size="s" :color="entry.option.status === 'none' ? 'grey' : 'primary'" />
      <div class="main">
        <div class="line1">
          <span class="os-label-l name">{{ entry.config?.name ?? entry.option.delivery_method }}</span>
          <OsBadge :text="t(`status_${entry.option.status}`)" :color="statusColor(entry.option)" />
        </div>
        <span class="os-body-s os-text-secondary">{{ entry.option.delivery_method }}</span>
        <template v-if="entry.option.status !== 'none'">
          <span class="os-label-s eta">
            <OsIcon icon="calendar" size="xs" color="secondary" />
            {{ formatDate(entry.option.eta_start) }} → {{ formatDate(entry.option.eta_end) }}
          </span>
          <div class="facts os-body-s os-text-secondary">
            <span v-if="entry.option.cost !== undefined">{{ t('cost') }} {{ formatMoney(entry.option.cost, currency) }}</span>
            <span v-if="entry.option.shipment_number">{{ entry.option.shipment_number }} {{ t('shipments').toLowerCase() }}</span>
            <span v-if="legsCount(entry.option) > 1" class="multileg">{{ legsCount(entry.option) }} {{ t('legs') }}</span>
            <span v-if="entry.option.carbon_footprint !== undefined">{{ entry.option.carbon_footprint }} gCO₂</span>
          </div>
        </template>
        <span v-else class="os-label-s reason">{{ entry.option.reason ? t(`reason_${entry.option.reason}`) : '' }}</span>
      </div>
      <OsIcon icon="chevron-right" color="secondary" class="chev" />
    </button>
  </div>
</template>

<style scoped>
.results { display: flex; flex-direction: column; gap: 8px; }
.result {
  display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 1px solid var(--os-border); border-radius: 5px; background: #fff;
  cursor: pointer; text-align: left; font-family: Roboto, sans-serif; color: var(--os-text-primary); transition: border-color 0.15s, background 0.15s;
}
.result:hover { background: var(--os-surface-hover); }
.result.selected { border-color: var(--os-primary-1000); box-shadow: inset 3px 0 0 var(--os-primary-1000); background: #fff; }
.result.none .name { color: var(--os-text-secondary); }
.main { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.line1 { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eta { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.multileg { color: var(--os-purple-1000); font-weight: 500; }
.reason { color: var(--os-red-1000); }
.chev { align-self: center; }
</style>
