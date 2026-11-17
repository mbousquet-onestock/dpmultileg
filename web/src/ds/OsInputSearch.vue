<script setup lang="ts">
import OsField from './OsField.vue';
import OsIcon from './OsIcon.vue';
defineProps<{ modelValue?: string; label?: string; placeholder?: string; pending?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [string]; blur: []; focus: [] }>();
</script>
<template>
  <OsField :label="label">
    <input
      class="os-input-search-field"
      type="search"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @blur="emit('blur')"
      @focus="emit('focus')"
    />
    <button v-if="modelValue && !pending" type="button" class="os-input-search-btn" aria-label="clear" @click="emit('update:modelValue', '')">
      <OsIcon icon="close" size="s" color="secondary" />
    </button>
    <span v-else class="os-input-search-btn"><OsIcon :icon="pending ? 'loader' : 'search'" size="s" color="secondary" :rotation="pending" /></span>
  </OsField>
</template>
<style scoped>
.os-input-search-field { flex: 1; min-width: 0; height: 34px; padding: 8px 8px 8px 12px; border: 0; font: 400 14px Roboto, sans-serif; color: var(--os-text-primary); background: transparent; outline: none; }
.os-input-search-field::-webkit-search-cancel-button { display: none; }
.os-input-search-btn { display: inline-flex; align-items: center; border: 0; background: none; padding: 0 10px; cursor: pointer; }
</style>
