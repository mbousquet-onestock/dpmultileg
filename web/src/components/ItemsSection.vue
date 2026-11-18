<script setup lang="ts">
import { OsButton, OsEntity, OsIcon, OsInputNumber, OsInputSearch, OsModal } from '@onestock-public/design-system';
import type { Item } from '@shared/types';
import { ref, watch } from 'vue';
import { api } from '../api';
import { formatMoney, lang, t } from '../i18n';
import { addLine, currency, state } from '../store';

const open = ref(false);
const query = ref('');
const pending = ref(false);
const found = ref<Item[]>([]);
const total = ref(0);
let timer: number | undefined;
let seq = 0;

const PAGE = 5;
/** Quantity to add for each item of the results (1 by default). */
const qty = ref<Record<string, number>>({});
const added = ref<string | null>(null);
function add(item: Item) {
  addLine(item, Math.max(1, qty.value[item.id] ?? 1));
  added.value = item.id;
  window.setTimeout(() => added.value === item.id && (added.value = null), 1500);
}
const loadingMore = ref(false);

async function search() {
  const id = ++seq;
  pending.value = true;
  try {
    const res = await api.searchItems(query.value.trim(), lang.value, 0, PAGE);
    if (id !== seq) return;
    found.value = res.items;
    total.value = res.total;
  } catch {
    if (id === seq) found.value = [];
  } finally {
    if (id === seq) pending.value = false;
  }
}

/** Next 10 items of the same search. */
async function more() {
  const id = seq;
  loadingMore.value = true;
  try {
    const res = await api.searchItems(query.value.trim(), lang.value, found.value.length, PAGE);
    if (id !== seq) return;
    found.value = [...found.value, ...res.items.filter((i) => !found.value.some((f) => f.id === i.id))];
    total.value = res.total;
  } finally {
    loadingMore.value = false;
  }
}

watch(query, () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(search, 300);
});
watch(open, (v) => v && search());

const price = (i: Item) => (i.price !== undefined && i.price !== '' && !Number.isNaN(Number(i.price)) ? formatMoney(Number(i.price), currency.value) : '');
</script>

<template>
  <section class="items">
    <div class="cards">
      <div v-for="(line, idx) in state.lines" :key="line.item.id" class="item-card">
        <OsButton class="remove" type="tertiary" icon="close" :aria-label="t('remove')" @click="state.lines.splice(idx, 1)" />
        <div class="thumb">
          <img v-if="line.item.image" :src="line.item.image" alt="" />
          <OsIcon v-else icon="item" color="secondary" size="l" />
        </div>
        <div class="name os-label-l" :title="line.item.name ?? line.item.id">{{ line.item.name ?? line.item.id }}</div>
        <div class="os-body-s os-text-secondary ref" :title="line.item.id">{{ line.item.id }}</div>
        <OsInputNumber v-model="line.qty" :min="1" :step="1" class="qty" :label="t('quantity')" />
      </div>
      <button type="button" class="item-card add" @click="open = true">
        <span class="plus"><OsIcon icon="add" /></span>
        <span class="os-label-m">{{ t('addItem') }}</span>
      </button>
    </div>

    <OsModal v-model:visible="open" :title="t('addItem')" size="m">
      <div class="search">
        <OsInputSearch v-model="query" :placeholder="t('searchItems')" :pending="pending" />
        <div class="results">
          <OsEntity
            v-for="item in found"
            :key="item.id"
            class="result"
            :image="item.image || undefined"
            :icon="item.image ? undefined : 'item'"
            :primary-text="item.name ?? item.id"
            :secondary-text="item.id"
            :tertiary-text="price(item) || undefined"
          >
            <template #end>
              <OsInputNumber
                class="qty-input"
                :model-value="qty[item.id] ?? 1"
                :min="1"
                :step="1"
                :aria-label="t('quantity')"
                @update:model-value="qty[item.id] = $event ?? 1"
              />
              <OsButton
                type="secondary"
                :icon="added === item.id ? 'check' : 'add'"
                :text="added === item.id ? t('added') : t('add')"
                @click="add(item)"
              />
            </template>
          </OsEntity>
          <p v-if="!pending && !found.length" class="os-label-s os-text-secondary">{{ t('noItem') }}</p>
          <div v-if="found.length && found.length < total" class="more">
            <span class="os-body-s os-text-secondary">{{ t('itemsShown').replace('{n}', String(found.length)).replace('{total}', String(total)) }}</span>
            <OsButton type="secondary" :text="t('showMore')" :pending="loadingMore" @click="more" />
          </div>
        </div>
      </div>
      <template #primaryActions>
        <OsButton :text="t('close')" @click="open = false" />
      </template>
    </OsModal>
  </section>
</template>

<style scoped>
.cards { display: flex; flex-wrap: wrap; gap: 16px; }
.item-card {
  position: relative; width: 200px; min-height: 190px; box-sizing: border-box; padding: 16px; border: 1px solid var(--os-border);
  border-radius: 5px; background: #fff; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center;
}
.item-card .remove { position: absolute; top: 4px; right: 4px; }
.thumb { width: 80px; height: 80px; border-radius: 5px; background: var(--os-neutral-50); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.name, .ref { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name { color: var(--os-text-primary); }
.qty { width: 100%; text-align: left; margin-top: auto; }
.item-card.add { cursor: pointer; justify-content: center; font-family: Roboto, sans-serif; color: var(--os-text-primary); }
.item-card.add:hover { background: var(--os-surface-hover); }
.plus { width: 80px; height: 80px; border-radius: 5px; background: var(--os-neutral-50); display: flex; align-items: center; justify-content: center; margin-bottom: 18px; color: var(--os-neutral-700); }
.search { display: flex; flex-direction: column; gap: 12px; }
.results { display: flex; flex-direction: column; gap: 4px; }
.result { padding: 8px; border-radius: 5px; }
.result:hover { background: var(--os-surface-hover); }
.qty-input { width: 80px; }
.more { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 8px; }
</style>
