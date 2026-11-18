<script setup lang="ts">
withDefaults(defineProps<{ text?: string; position?: 'bottom' | 'top' | 'left' | 'right' }>(), { position: 'bottom' });
</script>
<template>
  <div class="os-tooltip-container ds-tooltip-anchor" :class="`ds-tooltip-${position}`">
    <slot />
    <div v-if="text || $slots.content" class="ds-tooltip os-floating-layout os-tooltip" role="tooltip"><slot name="content">{{ text }}</slot></div>
  </div>
</template>
