<script setup lang="ts">
import OsIcon from './OsIcon.vue';
defineProps<{ text: string; type: 'primary' | 'secondary' | 'tertiary'; icon?: string; disabled?: boolean }>();
</script>
<template>
  <span class="os-text" :class="[type, { disabled }]"><OsIcon v-if="icon" :icon="icon" size="s" color="secondary" />{{ text }}</span>
</template>
<style scoped>
.os-text { display: inline-flex; align-items: center; gap: 4px; font-family: Roboto, sans-serif; }
.primary { font-size: 16px; font-weight: 500; color: var(--os-text-primary); }
.secondary { font-size: 14px; color: var(--os-text-primary); }
.tertiary { font-size: 14px; color: var(--os-text-secondary); }
.disabled { opacity: 0.4; }
</style>
