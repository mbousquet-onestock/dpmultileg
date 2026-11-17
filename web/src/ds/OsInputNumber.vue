<script setup lang="ts">
import OsField from './OsField.vue';
const props = defineProps<{ modelValue?: number; label?: string | { value: string }; placeholder?: string; min?: number; max?: number; step?: number; error?: string | boolean; supportingText?: string; disabled?: boolean; readonly?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [number | undefined] }>();
function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  if (raw === '') return emit('update:modelValue', undefined);
  let n = Number(raw);
  if (Number.isNaN(n)) return;
  if (props.min !== undefined) n = Math.max(props.min, n);
  if (props.max !== undefined) n = Math.min(props.max, n);
  emit('update:modelValue', n);
}
</script>
<template>
  <OsField :label="label" :error="error" :supporting-text="supportingText" :disabled="disabled">
    <input
      class="os-input-number-field"
      type="number"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :min="min"
      :max="max"
      :step="step"
      :readonly="readonly"
      @change="onInput"
    />
  </OsField>
</template>
<style scoped>
.os-input-number-field { width: 100%; height: 34px; padding: 8px 8px 8px 12px; border: 0; border-radius: 5px; font: 400 14px Roboto, sans-serif; color: var(--os-text-primary); background: transparent; outline: none; }
.os-input-number-field::placeholder { color: var(--os-text-placeholder); }
</style>
