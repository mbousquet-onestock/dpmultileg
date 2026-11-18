<script setup lang="ts">
import OsField from './OsField.vue';
const props = defineProps<{ modelValue?: number; label?: string | { value: string }; placeholder?: string; min?: number; max?: number; step?: number; error?: string | boolean; supportingText?: string; disabled?: boolean; readonly?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [number | undefined] }>();
function onChange(e: Event) {
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
  <OsField :label="label" :error="error" :supporting-text="supportingText" :disabled="disabled" :readonly="readonly">
    <div class="os-input-number" data-testid="os-input-number">
      <input
        class="os-input-number-field"
        data-testid="os-input-number-field"
        type="number"
        :value="modelValue ?? ''"
        :placeholder="placeholder"
        :min="min"
        :max="max"
        :step="step"
        :readonly="readonly"
        :disabled="disabled"
        @change="onChange"
      />
    </div>
  </OsField>
</template>
