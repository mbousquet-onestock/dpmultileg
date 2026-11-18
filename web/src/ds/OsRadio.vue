<script setup lang="ts">
defineProps<{ name: string; value: string; modelValue?: string; label?: string; disabled?: boolean; readonly?: boolean }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <label class="label" :class="{ 'os-radio-disabled': disabled, readonly }" data-testid="os-radio-label">
    <input
      type="radio"
      class="os-radio"
      data-testid="os-radio-input"
      :name="name"
      :value="value"
      :checked="modelValue === value"
      :disabled="disabled || readonly"
      @change="$emit('update:modelValue', value)"
    />
    <div class="os-radio-control-container"><div class="os-radio-control" /></div>
    <span v-if="label" class="os-radio-label">{{ label }}</span>
  </label>
</template>
