<script setup lang="ts">
/** Report of the OneStock referential loading (one line per API call), to diagnose a configuration. */
import { OsBadge, OsButton, OsCollapse } from '@onestock-public/design-system';
import { computed, ref } from 'vue';
import { t } from '../i18n';
import { loadReferential, state } from '../store';

const report = computed(() => state.referential?.load_report ?? []);
/** Blocking issues: a required step failed, returned nothing, or some referenced ids are missing. */
const failed = computed(() => report.value.filter((r) => !r.optional && (!r.ok || r.count === 0 || r.partial)));
function status(r: (typeof report.value)[number]) {
  if (!r.ok) return r.optional ? { text: t('loadOptionalKo'), color: 'grey' } : { text: 'KO', color: 'red' };
  if (r.count === 0) return r.optional ? { text: '0', color: 'grey' } : { text: '0', color: 'orange' };
  return { text: String(r.count), color: r.partial ? 'orange' : 'green' };
}
const open = ref(false);
const reloading = ref(false);

async function reload() {
  reloading.value = true;
  try {
    await loadReferential(true);
  } finally {
    reloading.value = false;
  }
}
</script>

<template>
  <div v-if="report.length" class="load-report">
    <OsCollapse v-model="open">
      <template #header>
        <div class="head">
          <span class="os-body-l">{{ t('loadTitle') }}</span>
          <OsBadge
            :text="failed.length ? t('loadIssues').replace('{n}', String(failed.length)) : t('loadOk')"
            :color="failed.length ? 'orange' : 'green'"
          />
        </div>
      </template>
      <template #content>
        <table class="os-body-s">
          <thead>
            <tr>
              <th>{{ t('loadStep') }}</th>
              <th>{{ t('loadCall') }}</th>
              <th>{{ t('loadCount') }}</th>
              <th>{{ t('loadDetail') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in report" :key="r.step" :class="{ ko: !r.ok && !r.optional, empty: !r.optional && r.ok && (r.count === 0 || r.partial), optional: r.optional && (!r.ok || r.count === 0) }">
              <td>{{ r.step }}</td>
              <td class="mono">{{ r.path }}</td>
              <td>
                <OsBadge :text="status(r).text" :color="status(r).color" />
              </td>
              <td>
                {{ r.error ?? r.detail ?? '' }}
                <span v-if="r.optional && (!r.ok || r.count === 0)" class="os-text-secondary"> ({{ t('loadOptional') }})</span>
                <span class="os-text-secondary">· {{ r.ms }} ms</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="actions">
          <OsButton type="secondary" icon="refresh" :text="t('loadReload')" :pending="reloading" @click="reload" />
        </div>
      </template>
    </OsCollapse>
  </div>
</template>

<style scoped>
.load-report { border: 1px solid var(--os-border); border-radius: 5px; background: #fff; padding: 4px 12px; margin-bottom: 16px; }
.head { display: flex; align-items: center; gap: 8px; }
.head .os-body-l { color: var(--os-text-primary); }
table { width: 100%; border-collapse: collapse; color: var(--os-text-primary); }
th { text-align: left; font-weight: 500; color: var(--os-text-secondary); padding: 6px 8px; border-bottom: 1px solid var(--os-border); }
td { padding: 6px 8px; border-bottom: 1px solid var(--os-neutral-50); vertical-align: top; }
tr.ko td { background: var(--os-red-t-100); }
tr.empty td { background: var(--os-orange-t-100); }
tr.optional td { color: var(--os-text-secondary); }
.mono { font-family: ui-monospace, monospace; font-size: 11px; white-space: nowrap; }
.actions { display: flex; justify-content: flex-end; padding: 8px 0; }
</style>
