<script setup lang="ts">
import { OsAlert, OsButton, OsCardLayout, OsInputText, OsSelect } from '@onestock-public/design-system';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { t } from '../i18n';

const emit = defineEmits<{ connect: [{ site_id: string; environment: string }] }>();
const siteId = ref(new URLSearchParams(location.search).get('site_id') ?? localStorage.getItem('dpm.site') ?? '');
const environment = ref('');
const envs = ref<{ environment: string; label: string | null }[]>([]);
const error = ref('');
let timer: number | undefined;

watch(
  siteId,
  (v) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      envs.value = v ? (await api.environments(v).catch(() => ({ environments: [] }))).environments : [];
      if (!envs.value.some((e) => e.environment === environment.value)) environment.value = envs.value[0]?.environment ?? '';
    }, 250);
  },
  { immediate: true },
);

const envOptions = computed(() => envs.value.map((e) => ({ id: e.environment, primaryText: e.label ?? e.environment, secondaryText: e.environment })));

function submit() {
  error.value = '';
  try {
    localStorage.setItem('dpm.site', siteId.value);
  } catch {
    /* ignore */
  }
  emit('connect', { site_id: siteId.value, environment: environment.value });
}
</script>
<template>
  <OsCardLayout>
    <form class="connect" @submit.prevent="submit">
      <span class="os-title-m">{{ t('standaloneTitle') }}</span>
      <OsAlert type="info" :subtitle="t('standaloneHint')" />
      <OsInputText v-model="siteId" :label="t('siteId')" placeholder="c00" />
      <OsSelect v-model="environment" :label="t('environment')" :options="envOptions" placeholder="—" />
      <OsAlert v-if="error" type="danger" :subtitle="error" />
      <div><OsButton :text="t('connect')" icon="arrow-right" :disabled="!siteId || !environment" @click="submit" /></div>
    </form>
  </OsCardLayout>
</template>
<style scoped>
.connect { display: flex; flex-direction: column; gap: 14px; max-width: 420px; }
</style>
