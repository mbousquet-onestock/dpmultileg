<script setup lang="ts">
import OsIcon from './OsIcon.vue';
const props = withDefaults(defineProps<{ modelValue: boolean | 'mixed'; label?: string; color?: string; disabled?: boolean; readonly?: boolean }>(), { color: 'primary' });
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
const toggle = () => !props.disabled && !props.readonly && emit('update:modelValue', props.modelValue !== true);
</script>
<template>
  <label class="label" :class="{ disabled, readonly }" data-testid="os-checkbox" @click.prevent="toggle">
    <span class="os-checkbox-input-container">
      <input type="checkbox" :checked="modelValue === true" :class="{ checked: modelValue === true }" :disabled="disabled" />
      <span class="os-checkbox-icon-container">
        <OsIcon
          :icon="modelValue === 'mixed' ? 'checkbox-indeterminate' : modelValue ? 'checkbox-checked' : 'checkbox-unchecked'"
          class="os-checkbox-icon"
          :class="modelValue ? color : undefined"
        />
      </span>
      <span v-if="label">{{ label }}</span>
    </span>
  </label>
</template>
