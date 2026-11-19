<script setup lang="ts">
import { OsInputNumber, OsInputText, OsRadio, OsSelect, OsSelectMultiple, type OsMenuOptionItem } from '@onestock-public/design-system';
import { computed, watch } from 'vue';
import { countryName, t } from '../i18n';
import { channelMethods, currency, endpoints, loadEndpoints, salesChannels, state } from '../store';
import OptionCard from './OptionCard.vue';

const channelOptions = computed<OsMenuOptionItem[]>(() =>
  salesChannels.value.map((s) => ({ id: s.id, primaryText: s.name ?? s.id, secondaryText: s.name ? s.id : undefined })),
);

const COMMON_COUNTRIES = ['FR', 'BE', 'DE', 'ES', 'IT', 'NL', 'LU', 'PT', 'CH', 'GB', 'US', 'CA'];
const countryOptions = computed<OsMenuOptionItem[]>(() => {
  const codes = new Set<string>();
  for (const z of state.referential?.zones ?? []) for (const c of z.country_codes ?? []) codes.add(c.toUpperCase());
  for (const c of COMMON_COUNTRIES) codes.add(c);
  return [...codes].map((c) => ({ id: c, primaryText: countryName(c), secondaryText: c })).sort((a, b) => a.primaryText.localeCompare(b.primaryText));
});

const timezoneOptions = computed<OsMenuOptionItem[]>(() => {
  const set = new Set<string>();
  for (const z of state.referential?.zones ?? []) for (const tz of z.timezones ?? []) set.add(tz);
  try {
    for (const tz of Intl.supportedValuesOf('timeZone')) set.add(tz);
  } catch {
    /* old browsers */
  }
  return [{ id: '', primaryText: '—' }, ...[...set].sort().map((tz) => ({ id: tz, primaryText: tz }))];
});

const zoneOptions = computed<OsMenuOptionItem[]>(() =>
  (state.referential?.zones ?? []).map((z) => ({ id: z.id, primaryText: z.name ?? z.id, secondaryText: z.name ? z.id : undefined })),
);

const endpointOptions = computed<OsMenuOptionItem[]>(() =>
  endpoints.value.map((e) => ({
    id: e.id,
    primaryText: e.name ?? e.id,
    secondaryText: [e.id, e.address?.city].filter(Boolean).join(' · '),
    icon: 'store',
  })),
);

const methodOptions = computed<OsMenuOptionItem[]>(() =>
  channelMethods.value.map((c) => ({ id: c.delivery_method, primaryText: c.name ?? c.delivery_method, secondaryText: c.delivery_method })),
);

watch(
  () => state.destType,
  (type) => {
    if (type === 'endpoint') loadEndpoints().catch(() => undefined);
  },
);

// Keep only the methods existing in the selected channel.
watch(
  () => state.salesChannel,
  () => {
    state.methods.values = state.methods.values.filter((m) => channelMethods.value.some((c) => c.delivery_method === m));
  },
);

function toggleMethods(on: boolean) {
  state.methods.enabled = on;
  if (on && !state.methods.values.length) state.methods.values = channelMethods.value.map((c) => c.delivery_method);
}

function toggleDate(on: boolean) {
  state.date.enabled = on;
  if (on && !state.date.value) {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    state.date.value = d.toISOString().slice(0, 16);
  }
}
</script>

<template>
  <div class="options">
    <OptionCard icon="hub" :title="t('salesChannel')" :subtitle="t('salesChannelHint')">
      <OsSelect v-model="state.salesChannel" class="field" :label="t('salesChannels')" :options="channelOptions" />
    </OptionCard>

    <OptionCard icon="earth" :title="t('destination')" :subtitle="t('destinationHint')">
      <div class="dest">
        <div class="dest-block" :class="{ active: state.destType === 'address' }">
          <OsRadio v-model="state.destType" name="dest" value="address" :label="t('address')" />
          <div v-if="state.destType === 'address'" class="dest-fields">
            <OsSelect v-model="state.address.country" class="field" :label="t('country')" :placeholder="t('selectCountry')" :options="countryOptions" />
            <div class="row">
              <OsInputText v-model="state.address.zip_code" :label="t('zipCode')" class="half" />
              <OsInputText v-model="state.address.state" :label="t('region')" class="half" />
            </div>
            <OsSelect v-model="state.address.timezone" class="field" :label="t('timezone')" placeholder=" " :options="timezoneOptions" />
          </div>
        </div>
        <div class="dest-block" :class="{ active: state.destType === 'zone' }">
          <OsRadio v-model="state.destType" name="dest" value="zone" :label="t('zone')" />
          <div v-if="state.destType === 'zone'" class="dest-fields">
            <OsSelect v-model="state.zoneId" class="field" :label="t('zone')" :placeholder="t('selectZone')" :options="zoneOptions" />
          </div>
        </div>
        <div class="dest-block" :class="{ active: state.destType === 'endpoint' }">
          <OsRadio v-model="state.destType" name="dest" value="endpoint" :label="t('stockLocation')" />
          <div v-if="state.destType === 'endpoint'" class="dest-fields">
            <OsSelect
              v-model="state.endpointId"
              class="field"
              :label="t('stockLocation')"
              :placeholder="t('selectStockLocation')"
              :options="endpointOptions"
              :menu="{ searchable: true }"
            />
          </div>
        </div>
      </div>
    </OptionCard>

    <OptionCard icon="money" :title="t('orderPrice')" :subtitle="t('orderPriceHint')" optional :active="state.price.enabled" @toggle="state.price.enabled = $event">
      <OsInputNumber v-model="state.price.value" class="field small" :label="`${t('orderPrice')} (${currency})`" :min="0" :step="0.01" />
    </OptionCard>

    <OptionCard icon="truck" :title="t('deliveryMethod')" :subtitle="t('deliveryMethodHint')" optional :active="state.methods.enabled" @toggle="toggleMethods">
      <OsSelectMultiple v-model="state.methods.values" class="field" :label="t('deliveryMethod')" :placeholder="t('allMethods')" :options="methodOptions" />
    </OptionCard>

    <OptionCard
      icon="merge"
      :title="t('consolidationTitle')"
      :subtitle="t('consolidationHint')"
      optional
      :active="state.consolidation"
      @toggle="state.consolidation = $event"
    >
      <p class="os-label-s os-text-secondary consolidation-text">{{ t('consolidationActive') }}</p>
    </OptionCard>

    <OptionCard icon="calendar" :title="t('dateTime')" :subtitle="t('dateTimeHint')" optional :active="state.date.enabled" @toggle="toggleDate">
      <label class="native-field field">
        <span class="os-label-text">{{ t('dateTime') }}</span>
        <input v-model="state.date.value" type="datetime-local" />
      </label>
    </OptionCard>
  </div>
</template>

<style scoped>
.options { display: flex; flex-direction: column; gap: 20px; }
.field { max-width: 400px; }
.field.small { max-width: 200px; }
.dest { display: flex; flex-direction: column; gap: 8px; }
.dest-block { border: 1px solid var(--os-border); padding: 0 12px; }
.dest-block.active { padding-bottom: 12px; }
.dest-fields { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--os-border); padding-top: 12px; }
.row { display: flex; gap: 12px; max-width: 400px; }
.half { flex: 1; max-width: 175px; }
.native-field { display: flex; flex-direction: column; gap: 2px; }
.consolidation-text { margin: 0; max-width: 560px; }
.os-label-text { font: 500 12px Roboto, sans-serif; color: var(--os-text-secondary); }
.native-field input {
  height: 36px; box-sizing: border-box; border: 1px solid var(--os-border); border-radius: 5px; padding: 0 12px;
  font: 400 14px Roboto, sans-serif; color: var(--os-text-primary); outline: none;
}
.native-field input:focus { border-color: var(--os-primary-1000); }
</style>
