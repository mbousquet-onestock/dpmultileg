<script setup lang="ts">
/** Explains an error and exposes every technical detail needed to diagnose it (copyable). */
import { OsAlert, OsButton, OsCollapse } from '@onestock-public/design-system';
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api';
import { t } from '../i18n';

const props = defineProps<{ error: unknown; step?: string; context?: Record<string, unknown> }>();
const open = ref(false);
const health = ref<unknown>(null);
const copied = ref(false);

const apiErr = computed(() => (props.error instanceof ApiError ? props.error : undefined));
const message = computed(() => {
  const e = props.error;
  if (e instanceof ApiError) return e.message !== e.code ? e.message : t(`err_${e.code}`) !== `err_${e.code}` ? t(`err_${e.code}`) : e.code;
  if (e instanceof Error) return t(`err_${e.message}`) !== `err_${e.message}` ? t(`err_${e.message}`) : e.message;
  return String(e);
});
const hint = computed(() => {
  const code = apiErr.value?.code ?? (props.error instanceof Error ? props.error.message : '');
  const key = `hint_${code}`;
  return t(key) !== key ? t(key) : undefined;
});

const report = computed(() => ({
  step: props.step,
  at: new Date().toISOString(),
  page: location.href.replace(/extension_signature=[^&]+/, 'extension_signature=***'),
  error: apiErr.value
    ? { status: apiErr.value.status, code: apiErr.value.code, message: apiErr.value.message, ...apiErr.value.info, details: apiErr.value.details }
    : { message: props.error instanceof Error ? props.error.message : String(props.error), stack: props.error instanceof Error ? props.error.stack : undefined },
  context: props.context,
  server_health: health.value,
}));

onMounted(async () => {
  console.error(`[dpmultileg] ${props.step ?? 'error'}`, report.value);
  try {
    health.value = await api.health();
  } catch (e) {
    health.value = e instanceof ApiError ? { status: e.status, code: e.code, ...e.info } : String(e);
  }
});

async function copy() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(report.value, null, 2));
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    open.value = true;
  }
}
</script>

<template>
  <OsAlert type="danger" :title="step ? `${t('genericError')} – ${step}` : t('genericError')" :subtitle="message">
    <template #content>
      <div class="extra">
        <span v-if="hint" class="os-label-s">{{ hint }}</span>
        <span v-if="apiErr" class="os-body-s meta">
          HTTP {{ apiErr.status || '—' }} · {{ apiErr.code }}<template v-if="apiErr.info.requestId"> · request id {{ apiErr.info.requestId }}</template>
        </span>
        <OsCollapse v-model="open">
          <template #header><span class="os-body-l">{{ t('technicalDetails') }}</span></template>
          <template #content>
            <pre class="raw">{{ JSON.stringify(report, null, 2) }}</pre>
          </template>
        </OsCollapse>
      </div>
    </template>
    <template #actions>
      <OsButton type="tertiary" color="neutral" icon="copy" :text="copied ? t('copied') : t('copy')" @click="copy" />
    </template>
  </OsAlert>
</template>

<style scoped>
.extra { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.meta { color: var(--os-neutral-700); }
.raw { margin: 0; max-height: 360px; overflow: auto; background: #fff; border: 1px solid var(--os-border); border-radius: 5px; padding: 10px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
</style>
