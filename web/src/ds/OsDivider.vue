<script setup lang="ts">
defineProps<{ vertical?: boolean }>();
</script>
<template>
  <div class="os-divider" :class="{ vertical }" role="separator" />
</template>
<style scoped>
.os-divider { height: 1px; width: 100%; background: var(--os-border); flex: none; }
.os-divider.vertical { width: 1px; height: auto; align-self: stretch; }
</style>
