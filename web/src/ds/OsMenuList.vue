<!-- Internal: dropdown menu used by OsSelect / OsSelectMultiple (equivalent of the DS OsMenu). -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import OsIcon from './OsIcon.vue';
import type { OsMenuOptionItem } from './types';
const props = defineProps<{ options: OsMenuOptionItem[]; selected: string[]; multiple?: boolean; searchable?: boolean }>();
const emit = defineEmits<{ pick: [string] }>();
const query = ref('');
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => `${o.primaryText} ${o.secondaryText ?? ''} ${o.id}`.toLowerCase().includes(q));
});
</script>
<template>
  <div class="os-menu os-shadow-floating-container" @click.stop>
    <div v-if="searchable" class="os-menu-search">
      <OsIcon icon="search" size="s" color="secondary" />
      <input v-model="query" type="text" autofocus placeholder="…" />
    </div>
    <ul role="listbox" :aria-multiselectable="multiple">
      <li
        v-for="o in filtered"
        :key="o.id"
        role="option"
        :aria-selected="selected.includes(o.id)"
        :class="{ selected: selected.includes(o.id) }"
        @click="emit('pick', o.id)"
      >
        <OsIcon v-if="multiple" :icon="selected.includes(o.id) ? 'checkbox-checked' : 'checkbox-unchecked'" size="s" :color="selected.includes(o.id) ? 'brand' : 'secondary'" />
        <OsIcon v-else-if="o.icon" :icon="o.icon" size="s" color="secondary" />
        <span class="os-menu-texts">
          <span class="os-menu-primary">{{ o.primaryText }}</span>
          <span v-if="o.secondaryText" class="os-menu-secondary">{{ o.secondaryText }}</span>
        </span>
        <OsIcon v-if="!multiple && selected.includes(o.id)" icon="check" size="s" color="brand" />
      </li>
      <li v-if="!filtered.length" class="empty">—</li>
    </ul>
  </div>
</template>
<style scoped>
.os-menu { position: absolute; z-index: 50; top: calc(100% + 4px); left: -1px; right: -1px; min-width: 200px; background: #fff; border-radius: 5px; padding: 4px; max-height: 320px; display: flex; flex-direction: column; }
.os-menu-search { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--os-border); margin-bottom: 4px; }
.os-menu-search input { border: 0; outline: none; flex: 1; font: 400 14px Roboto, sans-serif; height: 28px; }
ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
li { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 5px; cursor: pointer; font-size: 14px; color: var(--os-text-primary); }
li:hover { background: var(--os-surface-hover); }
li.selected:not(:hover) { background: var(--os-primary-100); }
li.empty { cursor: default; color: var(--os-text-secondary); }
.os-menu-texts { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.os-menu-primary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.os-menu-secondary { font-size: 12px; color: var(--os-text-secondary); }
</style>
