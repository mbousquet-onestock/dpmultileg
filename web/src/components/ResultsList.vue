<script setup lang="ts">
import { OsBadge, OsIcon, OsPicto, OsSelect, type OsMenuOptionItem } from '@onestock-public/design-system';
import type { DeliveryConfig } from '@shared/types';
import { shipmentsFromPromise, isClickAndCollect } from '@shared/logistics';
import type { PromiseOption } from '@shared/types';
import { formatMoney, formatRange, t } from '../i18n';
import { currency, destination, display, pickupStores, pickupStoresFor, refinePickupStore, state, zoneCtx } from '../store';

/** Collection stores offered for a click & collect result (nearest to the address first). */
function storeOptions(config: DeliveryConfig | undefined): OsMenuOptionItem[] {
  return pickupStoresFor(config).map((e) => ({
    id: e.id,
    primaryText: e.name ?? e.id,
    secondaryText: [e.address?.zip_code, e.address?.city].filter(Boolean).join(' ') || e.id,
    icon: 'store',
  }));
}
function storeOf(method: string): string {
  return pickupStores[method] ?? destination.value?.endpoint_id ?? '';
}
function onStore(method: string, id: unknown) {
  if (typeof id === 'string' && id && id !== storeOf(method)) void refinePickupStore(method, id);
}

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
    <p v-if="display.loadReport && state.stats" class="os-body-s os-text-secondary stats">
      {{
        t('statsLine')
          .replace('{total}', String(state.stats.total_ms))
          .replace('{stock}', String(state.stats.stock_ms))
          .replace('{cap}', String(state.stats.capacity_ms))
          .replace('{calls}', String(state.stats.capacity_calls))
          .replace('{rounds}', String(state.stats.capacity_rounds))
          .replace('{compute}', String(state.stats.compute_ms))
      }}
    </p>
    <div
      v-for="(entry, idx) in state.results ?? []"
      :key="`${entry.option.delivery_method}-${idx}`"
      class="card"
      :class="{ selected: state.selected === idx, none: entry.option.status === 'none' }"
    >
    <button type="button" class="result" @click="state.selected = idx">
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
            {{ formatRange(entry.option.eta_start, entry.option.eta_end) }}
          </span>
          <div class="facts os-body-s os-text-secondary">
            <span v-if="entry.option.shipping_fees !== undefined">{{ t('cost') }} {{ formatMoney(entry.option.shipping_fees, currency) }}</span>
            <span v-if="entry.option.cost !== undefined">{{ t('transportCost') }} {{ formatMoney(entry.option.cost, currency) }}</span>
            <span v-if="entry.option.shipment_number">{{ entry.option.shipment_number }} {{ t(entry.option.shipment_number > 1 ? 'shipments' : 'shipment').toLowerCase() }}</span>
            <span v-if="legsCount(entry.option) > 1" class="multileg">{{ legsCount(entry.option) }} {{ t('legs') }}</span>
            <span v-if="entry.option.carbon_footprint !== undefined">{{ entry.option.carbon_footprint }} gCO₂</span>
          </div>
        </template>
        <span v-else class="os-label-s reason">{{ entry.option.reason ? t(`reason_${entry.option.reason}`) : '' }}</span>
      </div>
      <OsIcon icon="chevron-right" color="secondary" class="chev" />
    </button>
    <div v-if="isClickAndCollect(entry.config) && storeOptions(entry.config).length" class="pick">
      <OsSelect
        :model-value="storeOf(entry.option.delivery_method)"
        class="pick-select"
        :label="t('pickupStore')"
        :placeholder="t('selectStockLocation')"
        :options="storeOptions(entry.config)"
        :menu="{ searchable: true }"
        :disabled="state.running"
        @update:model-value="onStore(entry.option.delivery_method, $event)"
      />
    </div>
    </div>
  </div>
</template>

<style scoped>
.stats { margin: 0 0 4px; }
.results { display: flex; flex-direction: column; gap: 8px; }
.card { border: 1px solid var(--os-border); border-radius: 5px; background: #fff; transition: border-color 0.15s; }
.card.selected { border-color: var(--os-primary-1000); box-shadow: inset 3px 0 0 var(--os-primary-1000); }
.card.none .name { color: var(--os-text-secondary); }
.result {
  display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 0; background: transparent; width: 100%;
  cursor: pointer; text-align: left; font-family: Roboto, sans-serif; color: var(--os-text-primary); transition: background 0.15s; border-radius: 4px;
}
.result:hover { background: var(--os-surface-hover); }
.pick { padding: 0 12px 12px 60px; }
.pick-select { max-width: 360px; }
.main { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.line1 { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eta { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.multileg { color: var(--os-purple-1000); font-weight: 500; }
.reason { color: var(--os-red-1000); }
.chev { align-self: center; }
</style>
