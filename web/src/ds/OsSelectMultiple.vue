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
  <div ref="root" class="os-select-multiple ds-anchor" data-testid="os-select-multiple">
    <OsField :label="label" :error="error" :supporting-text="supportingText" :disabled="disabled" :readonly="readonly">
      <div
        class="os-select-multiple-input"
        tabindex="0"
        role="combobox"
        data-testid="os-select-multiple-input"
        :aria-expanded="open"
        @click.prevent="!disabled && !readonly && (open = !open)"
        @keydown.esc="open = false"
      >
        <div class="os-select-multiple-options-container">
          <span v-if="!chips.length" class="os-select-multiple-placeholder">{{ placeholder }}</span>
          <div v-for="c in chips" :key="c.id" class="os-multi-select-element">
            <div class="os-multi-select-start"><span class="os-multi-select-text">{{ c.primaryText }}</span></div>
            <div role="button" class="os-multi-select-remove-button" tabindex="-1" aria-label="remove" @click.stop="pick(c.id)">
              <OsIcon icon="close" size="xs" color="secondary" />
            </div>
          </div>
        </div>
        <OsIcon :icon="open ? 'arrow-drop-up' : 'arrow-drop-down'" color="secondary" class="os-select-arrow" />
      </div>
      <template #floating>
        <OsMenuList v-if="open" :options="options" :selected="modelValue" multiple :searchable="menu?.searchable ?? options.length > 8" @pick="pick" />
      </template>
    </OsField>
  </div>
</template>
