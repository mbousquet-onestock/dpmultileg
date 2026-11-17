<script setup lang="ts">
import { OsAlert, OsBadge, OsButton, OsIcon } from '@onestock-public/design-system';
import { computed, onMounted, ref } from 'vue';
import { api, ApiError, type SessionInfo } from './api';
import ItemsSection from './components/ItemsSection.vue';
import OptionsSection from './components/OptionsSection.vue';
import ResultsList from './components/ResultsList.vue';
import SchemaView from './components/SchemaView.vue';
import StandaloneConnect from './components/StandaloneConnect.vue';
import { autoResize, handshake, isEmbedded, readParams } from './extension';
import { setLocale, t } from './i18n';
import { canRun, destination, loadReferential, runTest, salesChannels, state } from './store';

const params = readParams();
setLocale(params.lang ?? navigator.language, params.locale, params.timezone);

const phase = ref<'connecting' | 'standalone' | 'ready' | 'error'>('connecting');
const error = ref('');
const session = ref<SessionInfo>();
const channelName = computed(() => {
  const s = salesChannels.value.find((c) => c.id === state.salesChannel);
  return s?.name ?? s?.id ?? '';
});

function explain(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'missing_credentials') return t('missingCredentials');
    if (e.code === 'invalid_signature') return t('invalidSignature');
    const d = e.details as { message?: string } | undefined;
    return `${t('genericError')} : ${e.code}${d?.message ? ` – ${d.message}` : ''}`;
  }
  return `${t('genericError')} : ${e instanceof Error ? e.message : String(e)}`;
}

async function start(payload: Record<string, unknown>) {
  phase.value = 'connecting';
  error.value = '';
  try {
    session.value = await api.openSession(payload);
    await loadReferential();
    phase.value = 'ready';
  } catch (e) {
    error.value = explain(e);
    phase.value = isEmbedded() ? 'error' : 'standalone';
  }
}

onMounted(async () => {
  autoResize(params);
  if (isEmbedded()) {
    try {
      const data = await handshake(params);
      await start({
        site_id: data.site_id ?? params.site_id,
        user_id: data.user_id ?? params.user_id,
        extension_id: params.extension_id,
        extension_signature: data.extension_signature,
        api_url: data.api_url,
        lang: params.lang,
      });
    } catch (e) {
      error.value = explain(e);
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
      <OsAlert v-if="error" type="danger" :subtitle="error" class="mb" />
      <StandaloneConnect @connect="start({ ...$event, user_id: 'standalone' })" />
    </template>

    <OsAlert v-else-if="phase === 'error'" type="danger" :title="t('genericError')" :subtitle="error" />

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
          <OsAlert v-if="state.error" type="danger" :title="t('genericError')" :subtitle="state.error" class="mb" />
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
