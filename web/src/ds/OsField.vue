<!-- Internal: label / bordered field / supporting text (equivalent of the DS OsInputGroup). -->
<script setup lang="ts">
defineProps<{ label?: string | { value: string; description?: string }; error?: string | boolean; supportingText?: string; disabled?: boolean; focused?: boolean }>();
</script>
<template>
  <div class="os-input-group" :class="{ disabled }">
    <label class="os-label">
      <span v-if="label" class="os-label-text">{{ typeof label === 'string' ? label : label.value }}</span>
      <div class="os-input-group-field" :class="{ error: !!error, focused }"><slot /></div>
    </label>
    <span v-if="typeof error === 'string' && error" class="os-input-error">{{ error }}</span>
    <span v-else-if="supportingText" class="os-input-supporting">{{ supportingText }}</span>
  </div>
</template>
<style scoped>
.os-input-group { display: flex; flex-direction: column; gap: 2px; min-width: 0; color: var(--os-text-primary); }
.os-label { display: flex; flex-direction: column; gap: 2px; }
.os-label-text { font-family: Roboto, sans-serif; font-size: 12px; font-weight: 500; color: var(--os-text-secondary); line-height: 14px; }
.os-input-group-field {
  display: flex; align-items: center; height: 36px; border: 1px solid var(--os-border); border-radius: 5px; background: #fff;
  font-size: 14px; position: relative; transition: border-color 0.15s;
}
.os-input-group-field:hover { border-color: var(--os-neutral-200); }
.os-input-group-field.focused, .os-input-group-field:focus-within { border-color: var(--os-primary-1000); }
.os-input-group-field.error { border-color: var(--os-red-1000); }
.os-input-error { font-size: 12px; color: var(--os-red-1000); }
.os-input-supporting { font-size: 12px; color: var(--os-text-secondary); }
.disabled { opacity: 0.5; pointer-events: none; }
</style>
