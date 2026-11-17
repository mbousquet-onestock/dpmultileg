<script setup lang="ts">
import OsIcon from './OsIcon.vue';
const props = defineProps<{ modelValue: boolean | 'mixed'; label?: string; color?: string; disabled?: boolean; readonly?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
const toggle = () => !props.disabled && !props.readonly && emit('update:modelValue', props.modelValue !== true);
</script>
<template>
  <label class="os-checkbox" :class="{ disabled }" @click.prevent="toggle">
    <input type="checkbox" :checked="modelValue === true" class="sr" :disabled="disabled" />
    <OsIcon
      :icon="modelValue === 'mixed' ? 'checkbox-indeterminate' : modelValue ? 'checkbox-checked' : 'checkbox-unchecked'"
      :color="modelValue ? (color ?? 'brand') : 'primary'"
    />
    <span v-if="label">{{ label }}</span>
  </label>
</template>
<style scoped>
.os-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; color: var(--os-text-primary); }
.sr { position: absolute; opacity: 0; width: 0; height: 0; }
.disabled { opacity: 0.4; cursor: default; }
</style>
