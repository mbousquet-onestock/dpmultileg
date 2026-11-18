<script setup lang="ts">
withDefaults(defineProps<{ icon: string; color?: string; size?: 'l' | 'm' | 's' | 'xs'; disabled?: boolean; rotation?: boolean }>(), { size: 'm' });
</script>
<template>
  <div
    class="os-icon"
    :class="[`os-icon-size-${size}`, `os-icon-${icon}`, `os-icon-color-${disabled ? 'disabled' : color}`, { rotation }]"
    data-testid="os-icon"
    aria-hidden="true"
  />
</template>
