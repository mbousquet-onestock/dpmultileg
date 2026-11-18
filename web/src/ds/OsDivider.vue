<script setup lang="ts">
defineProps<{ vertical?: boolean }>();
</script>
<template>
  <div class="os-divider" :class="vertical ? 'os-divider--vertical' : 'os-divider--horizontal'" :aria-orientation="vertical ? 'vertical' : 'horizontal'" data-testid="os-divider" />
</template>
