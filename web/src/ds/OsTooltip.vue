<script setup lang="ts">
withDefaults(defineProps<{ text?: string; position?: 'bottom' | 'top' | 'left' | 'right' }>(), { position: 'bottom' });
</script>
<template>
  <span class="os-tooltip" :class="position">
    <slot />
    <span v-if="text || $slots.content" class="os-tooltip-bubble" role="tooltip"><slot name="content">{{ text }}</slot></span>
  </span>
</template>
<style scoped>
.os-tooltip { position: relative; display: inline-flex; }
.os-tooltip-bubble { position: absolute; z-index: 60; display: none; background: var(--os-neutral-800); color: #fff; font-size: 12px; padding: 6px 8px; border-radius: 5px; white-space: nowrap; max-width: 320px; pointer-events: none; }
.os-tooltip:hover .os-tooltip-bubble { display: block; }
.bottom .os-tooltip-bubble { top: calc(100% + 6px); left: 50%; transform: translateX(-50%); }
.top .os-tooltip-bubble { bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); }
.left .os-tooltip-bubble { right: calc(100% + 6px); top: 50%; transform: translateY(-50%); }
.right .os-tooltip-bubble { left: calc(100% + 6px); top: 50%; transform: translateY(-50%); }
</style>
