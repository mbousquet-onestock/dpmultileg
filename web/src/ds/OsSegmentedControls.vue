<script setup lang="ts">
import OsIcon from './OsIcon.vue';
defineProps<{ modelValue: string; tabs: { text: string; icon?: string; value: string }[] }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <div class="os-segmented-controls-wrapper">
    <div class="os-segmented-controls-container" role="tablist">
      <div
        v-for="t in tabs"
        :key="t.value"
        role="tab"
        tabindex="0"
        :aria-selected="modelValue === t.value"
        class="os-segmented-controls"
        :class="{ active: modelValue === t.value, 'os-segmented-controls-with-icon': !!t.icon }"
        :data-testid="`os-segmented-controls-value-${t.value}`"
        @click="$emit('update:modelValue', t.value)"
        @keydown.enter="$emit('update:modelValue', t.value)"
      >
        <OsIcon v-if="t.icon" :icon="t.icon" size="s" class="os-segmented-controls-icon" />
        <span>{{ t.text }}</span>
      </div>
    </div>
  </div>
</template>
