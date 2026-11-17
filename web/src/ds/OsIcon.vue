<script setup lang="ts">
withDefaults(defineProps<{ icon: string; color?: string; size?: 'l' | 'm' | 's' | 'xs'; disabled?: boolean; rotation?: boolean }>(), { size: 'm' });
</script>
<template>
  <div
    class="os-icon"
    :class="[`os-icon-size-${size}`, `os-icon-${icon}`, color && `os-icon-color-${color}`, { 'os-icon-rotation': rotation }]"
    :style="disabled ? { opacity: 0.4 } : undefined"
    aria-hidden="true"
  />
</template>
