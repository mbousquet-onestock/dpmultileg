<script setup lang="ts">
import OsIcon from './OsIcon.vue';
withDefaults(defineProps<{ icon: string; color?: string; size?: 'l' | 'm' | 's'; disabled?: boolean; rotation?: boolean }>(), {
  color: 'primary',
  size: 'm',
});
</script>
<template>
  <div class="os-picto" :class="[`os-picto-color-${disabled ? 'disabled' : color}`, `os-picto-size-${size}`]" data-testid="os-picto">
    <OsIcon :icon="icon" :size="size === 'l' ? 'l' : size === 's' ? 's' : 'm'" :rotation="rotation" />
  </div>
</template>
