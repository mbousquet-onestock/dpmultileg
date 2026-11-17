<script setup lang="ts">
import { computed, ref } from 'vue';
import OsField from './OsField.vue';
import OsIcon from './OsIcon.vue';
import OsMenuList from './OsMenuList.vue';
import type { OsMenuOptionItem } from './types';
import { useClickOutside } from './useOutside';
const props = withDefaults(
  defineProps<{ options: OsMenuOptionItem[]; modelValue?: string; label?: string; placeholder?: string; disabled?: boolean; readonly?: boolean; loading?: boolean; error?: string | boolean; supportingText?: string; menu?: { searchable?: boolean } }>(),
  { placeholder: 'Select an option' },
);
const emit = defineEmits<{ 'update:modelValue': [string] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
useClickOutside(root, () => (open.value = false));
const current = computed(() => props.options.find((o) => o.id === props.modelValue));
const searchable = computed(() => props.menu?.searchable ?? props.options.length > 8);
function toggle() {
  if (!props.disabled && !props.readonly && !props.loading) open.value = !open.value;
}
function pick(id: string) {
  emit('update:modelValue', id);
  open.value = false;
}
</script>
<template>
  <div ref="root" class="os-select">
    <OsField :label="label" :error="error" :supporting-text="supportingText" :disabled="disabled" :focused="open">
      <div class="os-select-input" tabindex="0" role="combobox" :aria-expanded="open" @click.prevent="toggle" @keydown.enter.prevent="toggle" @keydown.esc="open = false">
        <OsIcon v-if="current?.icon" :icon="current.icon" size="s" color="secondary" />
        <span class="os-select-input-text" :class="{ placeholder: !current }">{{ loading ? '…' : current?.primaryText ?? placeholder }}</span>
        <OsIcon :icon="open ? 'arrow-drop-up' : 'arrow-drop-down'" color="secondary" />
      </div>
      <OsMenuList v-if="open" :options="options" :selected="modelValue ? [modelValue] : []" :searchable="searchable" @pick="pick" />
    </OsField>
  </div>
</template>
<style scoped>
.os-select { min-width: 0; }
.os-select-input { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 8px 0 12px; cursor: pointer; outline: none; }
.os-select-input-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.placeholder { color: var(--os-text-placeholder); }
</style>
