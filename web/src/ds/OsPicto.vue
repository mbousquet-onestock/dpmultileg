<script setup lang="ts">
import OsIcon from './OsIcon.vue';
withDefaults(defineProps<{ icon: string; color?: string; size?: 'l' | 'm' | 's'; disabled?: boolean; rotation?: boolean }>(), {
  color: 'primary',
  size: 'm',
});
</script>
<template>
  <div class="os-picto" :class="[`os-picto-color-${color}`, `os-picto-size-${size}`, { disabled }]">
    <OsIcon :icon="icon" :size="size === 'l' ? 'l' : size === 's' ? 's' : 'm'" :rotation="rotation" />
  </div>
</template>
<style scoped>
.os-picto { display: flex; align-items: center; justify-content: center; border-radius: 50%; flex: none; }
.os-picto-size-l { width: 64px; height: 64px; }
.os-picto-size-m { width: 48px; height: 48px; }
.os-picto-size-s { width: 32px; height: 32px; }
.os-picto-color-primary { background: var(--os-primary-t-100); color: var(--os-primary-1000); }
.os-picto-color-red { background: var(--os-red-t-100); color: var(--os-red-1000); }
.os-picto-color-orange { background: var(--os-orange-t-100); color: var(--os-orange-1000); }
.os-picto-color-blue { background: var(--os-blue-t-100); color: var(--os-blue-1000); }
.os-picto-color-green { background: var(--os-green-t-100); color: var(--os-green-1000); }
.os-picto-color-purple { background: var(--os-purple-t-100); color: var(--os-purple-1000); }
.os-picto-color-grey, .os-picto-color-neutral { background: var(--os-neutral-t-50); color: var(--os-neutral-500); }
.disabled { opacity: 0.4; }
</style>
