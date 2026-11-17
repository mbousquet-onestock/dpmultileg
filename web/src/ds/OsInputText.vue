<script setup lang="ts">
defineProps<{ modelValue?: string; label?: string | { value: string }; placeholder?: string; error?: string | boolean; supportingText?: string; disabled?: boolean; readonly?: boolean; type?: 'text' | 'password'; autofocus?: boolean }>();
defineEmits<{ 'update:modelValue': [string]; blur: [FocusEvent]; focus: [FocusEvent] }>();
import OsField from './OsField.vue';
</script>
<template>
  <OsField :label="label" :error="error" :supporting-text="supportingText" :disabled="disabled">
    <input
      class="os-input-text-field"
      :type="type ?? 'text'"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :readonly="readonly"
      :autofocus="autofocus"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @blur="$emit('blur', $event)"
      @focus="$emit('focus', $event)"
    />
  </OsField>
</template>
<style scoped>
.os-input-text-field { width: 100%; height: 34px; padding: 8px 8px 8px 12px; border: 0; border-radius: 5px; font: 400 14px Roboto, sans-serif; color: var(--os-text-primary); background: transparent; outline: none; }
.os-input-text-field::placeholder { color: var(--os-text-placeholder); }
</style>
