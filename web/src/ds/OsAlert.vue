<script setup lang="ts">
import OsIcon from './OsIcon.vue';
const props = defineProps<{ type: 'warning' | 'neutral' | 'info' | 'danger' | 'success'; title?: string; subtitle?: string; icon?: string; hideIcon?: boolean }>();
const defaults = { warning: 'warning-outline', neutral: 'lightbulb-outline', info: 'info-outline', danger: 'error-outline', success: 'check-circle-outline' };
const icon = () => props.icon ?? defaults[props.type];
</script>
<template>
  <div class="os-alert" :class="type" role="status">
    <OsIcon v-if="!hideIcon" :icon="icon()" size="s" class="os-alert-icon" />
    <div class="os-alert-content">
      <div v-if="title" class="os-label-l">{{ title }}</div>
      <div v-if="subtitle" class="os-label-s">{{ subtitle }}</div>
      <slot name="content" />
    </div>
    <div v-if="$slots.actions" class="os-alert-actions"><slot name="actions" /></div>
  </div>
</template>
<style scoped>
.os-alert { display: flex; gap: 8px; padding: 8px 8px 8px 12px; border-radius: 5px; color: var(--os-text-primary); }
.os-alert-content { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.os-alert-icon { margin-top: 1px; }
.os-alert-actions { display: flex; gap: 4px; align-items: flex-start; }
.neutral { background: var(--os-neutral-t-30); }
.info { background: var(--os-blue-t-100); } .info .os-alert-icon { color: var(--os-blue-1000); }
.warning { background: var(--os-orange-t-100); } .warning .os-alert-icon { color: var(--os-orange-1000); }
.danger { background: var(--os-red-t-100); } .danger .os-alert-icon { color: var(--os-red-1000); }
.success { background: var(--os-green-t-100); } .success .os-alert-icon { color: var(--os-green-1000); }
</style>
