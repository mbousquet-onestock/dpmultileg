<script setup lang="ts">
import OsField from './OsField.vue';
defineProps<{ modelValue?: string; label?: string | { value: string }; placeholder?: string; error?: string | boolean; supportingText?: string; disabled?: boolean; readonly?: boolean; type?: 'text' | 'password'; autofocus?: boolean }>();
defineEmits<{ 'update:modelValue': [string]; blur: [FocusEvent]; focus: [FocusEvent] }>();
</script>
<template>
  <OsField :label="label" :error="error" :supporting-text="supportingText" :disabled="disabled" :readonly="readonly">
    <div class="os-input-text" data-testid="os-input-text">
      <input
        class="os-input-text-field"
        data-testid="os-input-text-field"
        :type="type ?? 'text'"
        :value="modelValue ?? ''"
        :placeholder="placeholder"
        :readonly="readonly"
        :disabled="disabled"
        :autofocus="autofocus"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @blur="$emit('blur', $event)"
        @focus="$emit('focus', $event)"
      />
    </div>
  </OsField>
</template>
