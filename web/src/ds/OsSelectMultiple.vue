<script setup lang="ts">
import { computed, ref } from 'vue';
import OsField from './OsField.vue';
import OsIcon from './OsIcon.vue';
import OsMenuList from './OsMenuList.vue';
import type { OsMenuOptionItem } from './types';
import { useClickOutside } from './useOutside';
const props = withDefaults(
  defineProps<{ options: OsMenuOptionItem[]; modelValue?: string[]; label?: string; placeholder?: string; disabled?: boolean; readonly?: boolean; error?: string | boolean; supportingText?: string; menu?: { searchable?: boolean } }>(),
  { modelValue: () => [] },
);
const emit = defineEmits<{ 'update:modelValue': [string[]]; select: [string] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
useClickOutside(root, () => (open.value = false));
const chips = computed(() => props.modelValue.map((id) => props.options.find((o) => o.id === id) ?? { id, primaryText: id }));
function pick(id: string) {
  emit('select', id);
  emit('update:modelValue', props.modelValue.includes(id) ? props.modelValue.filter((x) => x !== id) : [...props.modelValue, id]);
}
</script>
<template>
  <div ref="root" class="os-select-multiple">
    <OsField :label="label" :error="error" :supporting-text="supportingText" :disabled="disabled" :focused="open">
      <div class="os-select-input" tabindex="0" role="combobox" :aria-expanded="open" @click.prevent="!disabled && !readonly && (open = !open)" @keydown.esc="open = false">
        <div class="chips">
          <span v-if="!chips.length" class="placeholder">{{ placeholder }}</span>
          <span v-for="c in chips" :key="c.id" class="chip">
            {{ c.primaryText }}
            <button type="button" aria-label="remove" @click.stop="pick(c.id)"><OsIcon icon="close" size="xs" /></button>
          </span>
        </div>
        <OsIcon :icon="open ? 'arrow-drop-up' : 'arrow-drop-down'" color="secondary" />
      </div>
      <OsMenuList v-if="open" :options="options" :selected="modelValue" multiple :searchable="menu?.searchable ?? options.length > 8" @pick="pick" />
    </OsField>
  </div>
</template>
<style scoped>
.os-select-multiple :deep(.os-input-group-field) { height: auto; min-height: 36px; }
.os-select-input { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 3px 8px 3px 6px; cursor: pointer; outline: none; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
.chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 4px 2px 8px; border-radius: 5px; background: var(--os-primary-t-100); color: var(--os-primary-1000); font-size: 13px; font-weight: 500; }
.chip button { display: inline-flex; border: 0; background: none; color: inherit; cursor: pointer; padding: 2px; }
.placeholder { color: var(--os-text-placeholder); font-size: 14px; padding-left: 6px; }
</style>
