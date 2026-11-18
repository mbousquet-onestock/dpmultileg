<script setup lang="ts">
import OsIcon from './OsIcon.vue';
defineProps<{ text: string; type: 'primary' | 'secondary' | 'tertiary'; icon?: string; disabled?: boolean }>();
</script>
<template>
  <div class="os-text" :class="[type, { disabled }]">
    <div v-if="icon" class="os-text-start">
      <div class="os-text-icon"><OsIcon :icon="icon" size="s" /></div>
    </div>
    <span :class="type === 'primary' ? 'os-label-l' : type === 'secondary' ? 'os-label-m' : 'os-label-s'">{{ text }}</span>
  </div>
</template>
