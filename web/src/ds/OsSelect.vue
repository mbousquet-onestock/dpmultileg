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
  <div ref="root" class="os-select ds-anchor" data-testid="os-select">
    <OsField :label="label" :error="error" :supporting-text="supportingText" :disabled="disabled" :readonly="readonly">
      <div
        class="os-select-input"
        tabindex="0"
        role="combobox"
        data-testid="os-select-input"
        :aria-expanded="open"
        @click.prevent="toggle"
        @keydown.enter.prevent="toggle"
        @keydown.esc="open = false"
      >
        <div v-if="current?.icon" class="os-select-option-start-container"><OsIcon :icon="current.icon" size="s" color="secondary" /></div>
        <span class="os-select-input-text" :class="{ placeholder: !current }">{{ loading ? '…' : (current?.primaryText ?? placeholder) }}</span>
        <OsIcon :icon="open ? 'arrow-drop-up' : 'arrow-drop-down'" color="secondary" class="os-select-arrow" />
      </div>
      <template #floating>
        <OsMenuList v-if="open" :options="options" :selected="modelValue ? [modelValue] : []" :searchable="searchable" @pick="pick" />
      </template>
    </OsField>
  </div>
</template>
