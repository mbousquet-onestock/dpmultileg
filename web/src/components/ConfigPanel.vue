<script setup lang="ts">
/**
 * Hidden "API configuration" tab: stores the OneStock API user/password (and extension secret) used to generate
 * tokens for a site/environment. Protected by the server ADMIN_TOKEN; passwords are never sent back to the browser.
 */
import { OsAlert, OsBadge, OsButton, OsCardLayout, OsCheckbox, OsDivider, OsEntity, OsInputText, OsPicto, OsSelect } from '@onestock-public/design-system';
import { computed, onMounted, ref, watch } from 'vue';
import { adminApi, api, ApiError, type CredentialSummary } from '../api';
import { t } from '../i18n';
import { PRIORITY_PRESETS } from '@shared/logistics';
import { display, loadReferential, state } from '../store';

const props = defineProps<{ siteId?: string; environment?: string; handshakeApiUrl?: string; signedSite?: string }>();
const emit = defineEmits<{ saved: [{ site_id: string; environment: string }] }>();

const TOKEN_KEY = 'dpm.adminToken';
function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

const adminToken = ref(readToken());
const cred = ref({
  site_id: props.siteId ?? '',
  environment: props.environment ?? '',
  user_id: '',
  password: '',
  api_url: '',
  secret: '',
  label: '',
});
const list = ref<CredentialSummary[]>([]);
const listError = ref('');
const busy = ref<'' | 'list' | 'test' | 'save'>('');
const result = ref<{ type: 'success' | 'danger' | 'info'; title: string; subtitle?: string } | null>(null);

const existing = computed(() => list.value.find((c) => c.site_id === cred.value.site_id && c.environment === cred.value.environment));
/** Server options (from /api/health): is the screen protected by ADMIN_TOKEN, is the signature verified. */
const server = ref<{ admin_protected: boolean; verify_signature: boolean }>({ admin_protected: true, verify_signature: false });
/** Opened from OneStock with a valid signature: the admin password is not needed for this site. */
const viaOnestock = computed(() => !!props.signedSite && props.signedSite === cred.value.site_id);
const authorized = computed(() => !server.value.admin_protected || !!adminToken.value || viaOnestock.value);
const canSubmit = computed(() => authorized.value && !!cred.value.site_id && !!cred.value.environment && !!cred.value.user_id && (!!cred.value.password || !!existing.value));

watch(adminToken, (v) => {
  try {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode / iframe restrictions) */
  }
});

function describe(e: unknown): string {
  if (e instanceof ApiError) return e.code === 'server_misconfigured' ? `${e.message}. ${t('hint_server_misconfigured')}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

async function loadList() {
  if (!authorized.value) return;
  busy.value = 'list';
  listError.value = '';
  try {
    list.value = (await adminApi.list(adminToken.value, cred.value.site_id || undefined)).credentials;
    // Pre-fill the cred with the non-secret values already stored for this site/environment.
    if (existing.value && !cred.value.user_id) {
      cred.value.user_id = existing.value.user_id;
      cred.value.api_url = existing.value.api_url ?? '';
      cred.value.label = existing.value.label ?? '';
    }
  } catch (e) {
    list.value = [];
    listError.value = describe(e);
  } finally {
    busy.value = '';
  }
}

function payload() {
  return {
    site_id: cred.value.site_id.trim(),
    environment: cred.value.environment.trim(),
    user_id: cred.value.user_id.trim(),
    password: cred.value.password || undefined,
    api_url: cred.value.api_url.trim() || undefined,
    extension_secrets: cred.value.secret.trim() ? cred.value.secret.split(/[\s,]+/).filter(Boolean) : undefined,
    label: cred.value.label.trim() || undefined,
    handshake_api_url: props.handshakeApiUrl,
  };
}

async function test() {
  busy.value = 'test';
  result.value = null;
  try {
    const r = await adminApi.test(adminToken.value, payload());
    result.value = r.ok
      ? { type: 'success', title: t('cfgTestOk'), subtitle: r.api_url }
      : { type: 'danger', title: t('cfgTestKo'), subtitle: [r.message, r.api_url].filter(Boolean).join(' – ') };
  } catch (e) {
    result.value = { type: 'danger', title: t('cfgTestKo'), subtitle: describe(e) };
  } finally {
    busy.value = '';
  }
}

async function save() {
  busy.value = 'save';
  result.value = null;
  try {
    await adminApi.save(adminToken.value, payload());
    result.value = { type: 'success', title: t('cfgSaved'), subtitle: `${cred.value.site_id} · ${cred.value.environment}` };
    cred.value.password = '';
    cred.value.secret = '';
    await loadList();
    emit('saved', { site_id: cred.value.site_id, environment: cred.value.environment });
  } catch (e) {
    result.value = { type: 'danger', title: t('genericError'), subtitle: describe(e) };
  } finally {
    busy.value = '';
  }
}

function edit(c: CredentialSummary) {
  Object.assign(cred.value, { site_id: c.site_id, environment: c.environment, user_id: c.user_id, api_url: c.api_url ?? '', label: c.label ?? '', password: '', secret: '' });
  result.value = null;
}

async function remove(c: CredentialSummary) {
  if (!window.confirm(t('cfgConfirmDelete').replace('{x}', `${c.site_id} · ${c.environment}`))) return;
  try {
    await adminApi.remove(adminToken.value, c.site_id, c.environment);
    await loadList();
  } catch (e) {
    result.value = { type: 'danger', title: t('genericError'), subtitle: describe(e) };
  }
}

/* ------------------------------------------------------------------ priorities per delivery method (settings) */

const methods = computed(() => {
  const seen = new Map<string, string>();
  for (const c of state.referential?.delivery_configs ?? []) if (!seen.has(c.delivery_method)) seen.set(c.delivery_method, c.name ?? c.delivery_method);
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
});
const presetOptions = computed(() => [
  { id: '', primaryText: t('presetDefault') },
  ...Object.keys(PRIORITY_PRESETS).map((id) => ({ id, primaryText: t(`preset_${id}`) })),
]);
const prio = ref<Record<string, string>>({});
watch(
  () => state.referential?.settings,
  (st) => {
    const p = ((st ?? {}) as { priorities?: Record<string, unknown> }).priorities ?? {};
    prio.value = Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  },
  { immediate: true },
);
const prioBusy = ref(false);
const prioResult = ref<{ type: 'success' | 'danger'; text: string } | null>(null);
async function savePriorities() {
  if (!props.siteId || !props.environment) return;
  prioBusy.value = true;
  prioResult.value = null;
  try {
    const priorities = Object.fromEntries(Object.entries(prio.value).filter(([, v]) => !!v));
    await adminApi.saveSettings(adminToken.value, props.siteId, props.environment, { ...(state.referential?.settings ?? {}), priorities });
    await loadReferential();
    prioResult.value = { type: 'success', text: t('prioSaved') };
  } catch (e) {
    prioResult.value = { type: 'danger', text: describe(e) };
  } finally {
    prioBusy.value = false;
  }
}

onMounted(async () => {
  try {
    const h = await api.health();
    server.value = { admin_protected: h.admin_protected !== false, verify_signature: h.verify_signature === true };
  } catch {
    /* keep the protective defaults */
  }
  await loadList();
});
</script>

<template>
  <div class="config">
    <OsCardLayout>
      <div class="block">
        <div class="head">
          <OsPicto icon="eye" />
          <div class="texts">
            <span class="os-label-l">{{ t('displayTitle') }}</span>
            <span class="os-label-s os-text-secondary">{{ t('displayHint') }}</span>
          </div>
        </div>
        <div class="body checks">
          <OsCheckbox v-model="display.loadReport" :label="t('displayLoadReport')" />
          <OsCheckbox v-model="display.config" :label="t('displayConfig')" />
          <OsCheckbox v-model="display.consolidation" :label="t('displayConsolidation')" />
          <OsCheckbox v-model="display.timeline" :label="t('displayTimeline')" />
          <OsCheckbox v-model="display.reasons" :label="t('displayReasons')" />
        </div>
      </div>
    </OsCardLayout>

    <OsCardLayout v-if="methods.length">
      <div class="block">
        <div class="head">
          <OsPicto icon="sort" />
          <div class="texts">
            <span class="os-label-l">{{ t('prioTitle') }}</span>
            <span class="os-label-s os-text-secondary">{{ t('prioHint') }}</span>
          </div>
        </div>
        <div class="body">
          <div v-for="m in methods" :key="m.id" class="prio-row">
            <div class="prio-method">
              <span class="os-label-m">{{ m.name }}</span>
              <span class="os-body-s os-text-secondary">{{ m.id }}</span>
            </div>
            <OsSelect v-model="prio[m.id]" class="prio-select" :options="presetOptions" :placeholder="t('presetDefault')" />
          </div>
          <OsAlert v-if="prioResult" :type="prioResult.type" :subtitle="prioResult.text" />
          <div class="actions">
            <OsButton icon="save" :text="t('prioSave')" :pending="prioBusy" :disabled="!authorized || !siteId || !environment" @click="savePriorities" />
          </div>
        </div>
      </div>
    </OsCardLayout>

    <OsCardLayout>
      <div class="block">
        <div class="head">
          <OsPicto icon="key" />
          <div class="texts">
            <span class="os-label-l">{{ t('cfgTitle') }}</span>
            <span class="os-label-s os-text-secondary">{{ t('cfgHint') }}</span>
          </div>
        </div>

        <div class="body">
          <OsAlert v-if="!server.admin_protected" type="warning" :subtitle="t('cfgOpenWarning')" />
          <OsAlert v-else-if="viaOnestock" type="success" :subtitle="t('cfgViaOnestock')" />
          <OsInputText
            v-else
            v-model="adminToken"
            type="password"
            class="field"
            :label="t('cfgAdminToken')"
            :supporting-text="t('cfgAdminTokenHint')"
            @blur="loadList"
          />

          <OsDivider v-if="server.admin_protected" />

          <div class="grid">
            <OsInputText v-model="cred.site_id" :label="t('siteId')" placeholder="c00" @blur="loadList" />
            <OsInputText v-model="cred.environment" :label="t('environment')" placeholder="qualif" :supporting-text="t('cfgEnvHint')" />
            <OsInputText v-model="cred.user_id" :label="t('cfgUser')" />
            <OsInputText
              v-model="cred.password"
              type="password"
              :label="t('cfgPassword')"
              :placeholder="existing ? t('cfgUnchanged') : ''"
              :supporting-text="existing ? t('cfgPasswordKeep') : undefined"
            />
            <OsInputText v-model="cred.api_url" class="wide" :label="t('cfgApiUrl')" placeholder="https://c00.api.qualif.onestock-retail.com" :supporting-text="t('cfgApiUrlHint')" />
            <OsInputText
              v-if="server.verify_signature"
              v-model="cred.secret"
              type="password"
              class="wide"
              :label="t('cfgSecret')"
              :placeholder="existing?.has_extension_secrets ? t('cfgUnchanged') : ''"
              :supporting-text="t('cfgSecretHint')"
            />
            <OsInputText v-model="cred.label" :label="t('cfgLabel')" />
          </div>

          <OsAlert v-if="result" :type="result.type" :title="result.title" :subtitle="result.subtitle" />

          <div class="actions">
            <OsButton type="secondary" icon="refresh" :text="t('cfgTest')" :pending="busy === 'test'" :disabled="!canSubmit" @click="test" />
            <OsButton icon="save" :text="t('cfgSave')" :pending="busy === 'save'" :disabled="!canSubmit" @click="save" />
          </div>
        </div>
      </div>
    </OsCardLayout>

    <OsCardLayout v-if="authorized">
      <div class="block">
        <span class="os-label-l">{{ t('cfgConfigured') }}<template v-if="cred.site_id"> – {{ cred.site_id }}</template></span>
        <OsAlert v-if="listError" type="danger" :subtitle="listError" />
        <p v-else-if="!list.length && busy !== 'list'" class="os-label-s os-text-secondary">{{ t('cfgNone') }}</p>
        <OsEntity
          v-for="c in list"
          :key="`${c.site_id}/${c.environment}`"
          class="row"
          icon="lan"
          :primary-text="`${c.site_id} · ${c.environment}${c.label ? ` (${c.label})` : ''}`"
          :secondary-text="`${t('cfgUser')} : ${c.user_id}`"
          :tertiary-text="[c.api_url ?? t('cfgApiUrlAuto'), c.updated_at].join(' · ')"
        >
          <template #end>
            <OsBadge
              v-if="server.verify_signature"
              :text="c.has_extension_secrets ? t('cfgSigned') : t('cfgUnsigned')" :color="c.has_extension_secrets ? 'green' : 'orange'" />
            <OsButton type="tertiary" icon="edit" :aria-label="t('cfgEdit')" @click="edit(c)" />
            <OsButton type="tertiary" color="red" icon="trash" :aria-label="t('remove')" @click="remove(c)" />
          </template>
        </OsEntity>
      </div>
    </OsCardLayout>
  </div>
</template>

<style scoped>
.config { display: flex; flex-direction: column; gap: 20px; max-width: 900px; }
.block { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: center; gap: 16px; }
.texts { display: flex; flex-direction: column; }
.texts .os-label-l, .block > .os-label-l { color: var(--os-text-primary); }
.body { display: flex; flex-direction: column; gap: 16px; padding-left: 64px; }
.field { max-width: 400px; }
.checks { gap: 10px; }
.prio-row { display: flex; align-items: center; gap: 16px; }
.prio-method { display: flex; flex-direction: column; width: 220px; flex: none; }
.prio-method .os-label-m { color: var(--os-text-primary); }
.prio-select { flex: 1; max-width: 360px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.grid .wide { grid-column: 1 / -1; }
.actions { display: flex; gap: 8px; justify-content: flex-end; }
.row { padding: 8px; border: 1px solid var(--os-border); border-radius: 5px; }
@media (max-width: 640px) {
  .body { padding-left: 0; }
  .grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
