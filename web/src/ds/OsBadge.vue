<script setup lang="ts">
import OsIcon from './OsIcon.vue';
withDefaults(defineProps<{ text: string; color?: string; type?: 'primary' | 'secondary'; icon?: string; disabled?: boolean }>(), {
  color: 'primary',
  type: 'primary',
});
</script>
<template>
  <span class="os-badge" :class="[type, color, { disabled }]">
    <OsIcon v-if="icon" :icon="icon" size="xs" class="os-badge-icon" />
    <span class="os-badge-text">{{ text }}</span>
  </span>
</template>
