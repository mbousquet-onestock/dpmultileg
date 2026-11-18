<!-- Internal: equivalent of the design system OsInputGroup (label / bordered field / supporting text or error). -->
<script setup lang="ts">
defineProps<{ label?: string | { value: string; description?: string }; error?: string | boolean; supportingText?: string; disabled?: boolean; readonly?: boolean }>();
</script>
<template>
  <div class="os-input-group" :class="{ error: !!error, disabled, readonly }" data-testid="os-input-group">
    <label class="os-label" data-testid="os-input-group-label">
      <div v-if="label" class="os-label-content">
        <div class="os-label-text" :class="{ error: !!error, disabled }">{{ typeof label === 'string' ? label : label.value }}</div>
      </div>
      <div class="os-input-group-field">
        <slot name="start" />
        <div class="os-input-group-slot border-start" :class="{ 'border-end': !$slots.end }"><slot /></div>
        <slot name="end" />
      </div>
    </label>
    <span v-if="typeof error === 'string' && error" class="os-input-group-error">{{ error }}</span>
    <span v-else-if="supportingText" class="os-input-group-supporting-text">{{ supportingText }}</span>
    <slot name="floating" />
  </div>
</template>
