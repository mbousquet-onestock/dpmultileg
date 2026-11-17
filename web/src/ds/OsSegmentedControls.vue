<script setup lang="ts">
import OsIcon from './OsIcon.vue';
defineProps<{ modelValue: string; tabs: { text: string; icon?: string; value: string }[] }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <div class="os-segmented-controls-wrapper">
    <div class="os-segmented-controls-container" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.value"
        type="button"
        role="tab"
        :aria-selected="modelValue === t.value"
        class="os-segmented-controls"
        :class="{ active: modelValue === t.value }"
        @click="$emit('update:modelValue', t.value)"
      >
        <OsIcon v-if="t.icon" :icon="t.icon" size="s" />
        <span>{{ t.text }}</span>
      </button>
    </div>
  </div>
</template>
<style scoped>
.os-segmented-controls-container { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--os-border); border-radius: 7px; background: var(--os-neutral-30); }
.os-segmented-controls { display: flex; align-items: center; gap: 4px; padding: 8px 12px; border: 1px solid transparent; border-radius: 5px; background: none; color: var(--os-neutral-300); font: 500 14px Roboto, sans-serif; cursor: pointer; line-height: 16px; }
.os-segmented-controls:hover:not(.active) { color: var(--os-neutral-500); }
.os-segmented-controls.active { background: #fff; border-color: var(--os-border); color: var(--os-neutral-800); }
</style>
