<script setup lang="ts">
import OsIcon from './OsIcon.vue';
withDefaults(defineProps<{ text: string; color?: string; type?: 'primary' | 'secondary'; icon?: string; disabled?: boolean }>(), {
  color: 'primary',
  type: 'primary',
});
</script>
<template>
  <span class="os-badge" :class="[type, color, { disabled }]">
    <OsIcon v-if="icon" :icon="icon" size="xs" />
    <span class="os-badge-text">{{ text }}</span>
  </span>
</template>
<style scoped>
.os-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 12px; font-family: Roboto, sans-serif; font-size: 12px; font-weight: 500; line-height: 14px; white-space: nowrap; flex: none; }
.os-badge.secondary { border-radius: 5px; padding: 4px; }
.primary.primary, .os-badge.primary { background: var(--os-primary-t-100); color: var(--os-primary-1000); }
.os-badge.red { background: var(--os-red-t-100); color: var(--os-red-1000); }
.os-badge.orange { background: var(--os-orange-t-100); color: var(--os-orange-1000); }
.os-badge.blue { background: var(--os-blue-t-100); color: var(--os-blue-1000); }
.os-badge.green { background: var(--os-green-t-100); color: var(--os-green-1000); }
.os-badge.purple { background: var(--os-purple-t-100); color: var(--os-purple-1000); }
.os-badge.grey { background: var(--os-neutral-t-50); color: var(--os-neutral-700); }
.os-badge.neutral { background: var(--os-neutral-800); color: #fff; }
.disabled { opacity: 0.4; }
</style>
