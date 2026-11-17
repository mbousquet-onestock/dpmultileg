<script setup lang="ts">
defineProps<{ name: string; value: string; modelValue?: string; label?: string; disabled?: boolean; readonly?: boolean }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <label class="label" :class="{ disabled, readonly }">
    <input class="os-radio" type="radio" :name="name" :value="value" :checked="modelValue === value" :disabled="disabled || readonly" @change="$emit('update:modelValue', value)" />
    <span class="os-radio-control-container"><span class="os-radio-control" :class="{ checked: modelValue === value }" /></span>
    <span v-if="label" class="os-radio-label">{{ label }}</span>
  </label>
</template>
<style scoped>
.label { display: inline-flex; align-items: center; gap: 4px; height: 36px; padding-right: 8px; border-radius: 36px; cursor: pointer; font-size: 14px; color: var(--os-text-primary); }
.os-radio { position: absolute; opacity: 0; width: 0; height: 0; }
.os-radio-control-container { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; }
.label:hover .os-radio-control-container { background: var(--os-neutral-t-50); }
.os-radio-control { width: 20px; height: 20px; box-sizing: border-box; border: 2px solid var(--os-neutral-800); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.os-radio-control.checked { border-color: var(--os-primary-1000); }
.os-radio-control.checked::after { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--os-primary-1000); }
.os-radio:focus-visible + .os-radio-control-container { outline: 2px solid var(--os-primary-800); }
.disabled { opacity: 0.4; cursor: default; }
.readonly { cursor: default; }
</style>
