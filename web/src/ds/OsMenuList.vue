<!-- Internal: dropdown of OsSelect / OsSelectMultiple (design system OsMenu inside an OsFloatingLayout). -->
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
  <div class="ds-floating os-floating-layout" @click.stop>
    <div class="os-menu" data-testid="os-menu">
      <div v-if="searchable" class="os-input-group">
        <div class="os-input-group-field">
          <div class="os-input-group-slot border-start border-end">
            <div class="os-input-text"><input v-model="query" class="os-input-text-field" type="text" autofocus placeholder="…" /></div>
          </div>
        </div>
      </div>
      <div class="os-menu-option-layout" role="listbox" tabindex="-1" :aria-multiselectable="multiple">
        <div
          v-for="o in filtered"
          :key="o.id"
          class="os-menu-option"
          :class="{ selectable: multiple, active: !multiple && selected.includes(o.id) }"
          role="option"
          tabindex="0"
          :aria-selected="selected.includes(o.id)"
          @click="emit('pick', o.id)"
          @keydown.enter.prevent="emit('pick', o.id)"
        >
          <label v-if="multiple" class="readonly" data-testid="os-checkbox">
            <span class="os-checkbox-input-container">
              <span class="os-checkbox-icon-container">
                <OsIcon :icon="selected.includes(o.id) ? 'checkbox-checked' : 'checkbox-unchecked'" class="os-checkbox-icon" :class="{ primary: selected.includes(o.id) }" />
              </span>
            </span>
          </label>
          <div v-else-if="o.icon" class="os-menu-option-start-container"><OsIcon :icon="o.icon" size="s" color="secondary" /></div>
          <div class="os-menu-option-texts">
            <span class="os-text-highlighter os-label-s primary-text"><span>{{ o.primaryText }}</span></span>
            <span v-if="o.secondaryText" class="os-text-highlighter os-body-s secondary-text"><span>{{ o.secondaryText }}</span></span>
          </div>
        </div>
        <div v-if="!filtered.length" class="no-results-container text-pending os-label-s">—</div>
      </div>
    </div>
  </div>
</template>
