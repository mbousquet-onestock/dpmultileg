<script setup lang="ts">
import OsIcon from './OsIcon.vue';
const props = defineProps<{ type: 'warning' | 'neutral' | 'info' | 'danger' | 'success'; title?: string; subtitle?: string; icon?: string; hideIcon?: boolean }>();
const defaults = { warning: 'warning-outline', neutral: 'lightbulb-outline', info: 'info-outline', danger: 'error-outline', success: 'check-circle-outline' };
const icon = () => props.icon ?? defaults[props.type];
</script>
<template>
  <div class="os-alert" :class="type" role="status">
    <div class="os-alert-element">
      <OsIcon v-if="!hideIcon" :icon="icon()" size="s" class="os-alert-icon" />
      <div class="os-alert-content">
        <div v-if="title" class="os-label-l">{{ title }}</div>
        <div v-if="subtitle" class="os-label-s">{{ subtitle }}</div>
        <slot name="content" />
      </div>
    </div>
    <div v-if="$slots.actions" class="ds-alert-actions"><slot name="actions" /></div>
  </div>
</template>
