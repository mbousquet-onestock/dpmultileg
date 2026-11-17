<script setup lang="ts">
import OsIcon from './OsIcon.vue';
type Color = 'primary' | 'red' | 'orange' | 'blue' | 'neutral' | 'white-transparent';
const props = withDefaults(
  defineProps<{ text?: string; type?: 'primary' | 'secondary' | 'tertiary'; color?: Color; icon?: string | { name: string; position?: 'start' | 'end' }; disabled?: boolean; pending?: boolean }>(),
  { type: 'primary', color: 'primary' },
);
defineEmits<{ click: [MouseEvent] }>();
const iconName = () => (typeof props.icon === 'string' ? props.icon : props.icon?.name);
const iconEnd = () => typeof props.icon === 'object' && props.icon?.position === 'end';
</script>
<template>
  <button
    type="button"
    class="os-button"
    :class="[type, `os-button-${type}-${color}`, { 'os-button-icon-only': !text && icon, 'is-disabled': disabled || pending }]"
    :disabled="disabled || pending"
    @click="$emit('click', $event)"
  >
    <OsIcon v-if="pending" icon="loader" size="s" rotation />
    <OsIcon v-else-if="iconName() && !iconEnd()" :icon="iconName()!" size="s" />
    <span v-if="text" class="os-button-text">{{ text }}</span>
    <OsIcon v-if="!pending && iconName() && iconEnd()" :icon="iconName()!" size="s" />
  </button>
</template>
<style scoped>
.os-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 36px; padding: 8px 16px;
  border: 0; border-radius: 5px; cursor: pointer; font-family: Roboto, sans-serif; font-size: 14px; font-weight: 500;
  white-space: nowrap; transition: background-color 0.15s, filter 0.15s; flex: none;
}
.os-button-text { line-height: 16px; }
.os-button.primary { color: #fff; }
.os-button-primary-primary { background: var(--os-primary-1000); }
.os-button-primary-red { background: var(--os-red-1000); }
.os-button-primary-orange { background: var(--os-orange-1000); }
.os-button-primary-blue { background: var(--os-blue-1000); }
.os-button-primary-neutral { background: var(--os-neutral-700); }
.os-button.primary:hover:not(:disabled) { filter: brightness(1.07); }
.os-button.secondary { background: #fff; border: 1px solid var(--os-border); color: var(--os-neutral-700); }
.os-button.secondary:hover:not(:disabled) { background: var(--os-surface-hover); }
.os-button.tertiary { background: transparent; color: var(--os-neutral-700); }
.os-button-tertiary-primary { color: var(--os-primary-1000) !important; }
.os-button-tertiary-red { color: var(--os-red-1000) !important; }
.os-button.tertiary:hover:not(:disabled) { background: var(--os-neutral-t-50); }
.os-button-icon-only { padding: 6px; width: 36px; }
.os-button.tertiary.os-button-icon-only { border-radius: 50%; }
.os-button:disabled { cursor: default; opacity: 0.45; }
</style>
