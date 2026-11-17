<script setup lang="ts">
import { OsBadge, OsButton, OsIcon } from '@onestock-public/design-system';
import { computed, onMounted, ref } from 'vue';
import { api, type SessionInfo } from './api';
import ItemsSection from './components/ItemsSection.vue';
import OptionsSection from './components/OptionsSection.vue';
import ResultsList from './components/ResultsList.vue';
import SchemaView from './components/SchemaView.vue';
import ErrorPanel from './components/ErrorPanel.vue';
import StandaloneConnect from './components/StandaloneConnect.vue';
import { autoResize, handshake, isEmbedded, readParams } from './extension';
import { setLocale, t } from './i18n';
import { canRun, destination, loadReferential, runTest, salesChannels, state } from './store';

const params = readParams();
setLocale(params.lang ?? navigator.language, params.locale, params.timezone);

const phase = ref<'connecting' | 'standalone' | 'ready' | 'error'>('connecting');
const error = ref<unknown>(null);
const step = ref('');
/** Calling context shown in the diagnostic (no secret: the signature is masked). */
const context = ref<Record<string, unknown>>({ embedded: isEmbedded(), params });
const session = ref<SessionInfo>();
const channelName = computed(() => {
  const s = salesChannels.value.find((c) => c.id === state.salesChannel);
  return s?.name ?? s?.id ?? '';
});


async function start(payload: Record<string, unknown>) {
  phase.value = 'connecting';
  error.value = null;
  context.value = { ...context.value, session_request: { ...payload, extension_signature: payload.extension_signature ? '***' : undefined } };
  try {
    step.value = t('step_session');
    session.value = await api.openSession(payload);
    context.value = { ...context.value, session: { site_id: session.value.site_id, environment: session.value.environment, signed: session.value.signed } };
    step.value = t('step_referential');
    await loadReferential();
    phase.value = 'ready';
  } catch (e) {
    error.value = e;
    phase.value = isEmbedded() ? 'error' : 'standalone';
  }
}

onMounted(async () => {
  autoResize(params);
  if (isEmbedded()) {
    try {
      step.value = t('step_handshake');
      const data = await handshake(params);
      context.value = {
        ...context.value,
        onestock_data: { ...data, extension_signature: data.extension_signature ? `${String(data.extension_signature).slice(0, 12)}…` : undefined },
      };
      await start({
        site_id: data.site_id ?? params.site_id,
        user_id: data.user_id ?? params.user_id,
        extension_id: params.extension_id,
        extension_signature: data.extension_signature,
        api_url: data.api_url,
        lang: params.lang,
      });
    } catch (e) {
      error.value = e;
      phase.value = 'error';
    }
  } else {
    phase.value = 'standalone';
  }
});

const missing = computed(() => (!state.lines.length ? t('needItems') : !destination.value ? t('needDestination') : ''));
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="os-title-l">{{ t('title') }}</h1>
        <p class="os-label-s os-text-secondary">{{ t('subtitle') }}</p>
      </div>
      <div v-if="session" class="session">
        <OsBadge :text="`${session.site_id} · ${session.environment}`" color="grey" icon="lan" />
        <OsBadge v-if="session.mock" :text="t('mockMode')" color="orange" />
      </div>
    </header>

    <div v-if="phase === 'connecting'" class="center os-label-m os-text-secondary">
      <OsIcon icon="loader" rotation color="brand" /> {{ t('connecting') }}
    </div>

    <template v-else-if="phase === 'standalone'">
      <ErrorPanel v-if="error" :key="String(error)" :error="error" :step="step" :context="context" class="mb" />
      <StandaloneConnect @connect="start({ ...$event, user_id: 'standalone' })" />
    </template>

    <ErrorPanel v-else-if="phase === 'error'" :error="error" :step="step" :context="context" />

    <div v-else class="layout">
      <div class="form">
        <section>
          <h2 class="os-label-l section-title">{{ t('items') }}</h2>
          <ItemsSection />
        </section>
        <section>
          <h2 class="os-label-l section-title">{{ t('options') }}</h2>
          <OptionsSection />
        </section>
        <div class="run-bar">
          <OsBadge v-if="channelName" :text="channelName" />
          <span class="os-body-s os-text-secondary">{{ missing }}</span>
          <OsButton class="run" :text="t('test')" :pending="state.running" :disabled="!canRun" @click="runTest" />
        </div>
      </div>

      <div class="output">
        <section>
          <h2 class="os-label-l section-title">{{ t('results') }}</h2>
          <ErrorPanel v-if="state.error" :key="String(state.error)" :error="state.error" :step="t('step_test')" :context="context" class="mb" />
          <p v-if="!state.results" class="os-label-s os-text-secondary empty">{{ t('noResult') }}</p>
          <template v-else>
            <p class="os-body-s os-text-secondary hint">{{ t('resultsHint') }}</p>
            <ResultsList />
          </template>
        </section>
        <SchemaView />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 20px 24px 32px; max-width: 1600px; margin: 0 auto; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
h1 { margin: 0 0 2px; color: var(--os-text-primary); }
.page-head p { margin: 0; }
.session { display: flex; gap: 6px; }
.center { display: flex; align-items: center; gap: 8px; padding: 48px 0; justify-content: center; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
@media (min-width: 1280px) { .layout { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); align-items: start; } .output { position: sticky; top: 12px; } }
.form, .output { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
.section-title { margin: 0 0 10px; color: var(--os-text-primary); font-size: 18px; font-weight: 500; }
.run-bar {
  position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 12px 0;
  background: linear-gradient(to top, var(--os-surface-page-background) 70%, transparent); border-top: 1px solid var(--os-border);
}
.run { margin-left: auto; height: 44px; padding: 10px 28px; border-radius: 22px; }
.empty { padding: 24px; border: 1px dashed var(--os-border); border-radius: 5px; text-align: center; background: #fff; }
.hint { margin: 0 0 8px; }
.mb { margin-bottom: 12px; }
</style>
