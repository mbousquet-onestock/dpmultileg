<script setup lang="ts">
import OsIcon from './OsIcon.vue';
withDefaults(defineProps<{ text: string; color?: string; type?: 'primary' | 'secondary'; closable?: boolean; disabled?: boolean; readonly?: boolean }>(), {
  color: 'primary',
  type: 'primary',
});
defineEmits<{ click: []; close: [] }>();
</script>
<template>
  <div class="os-tag" :class="[type, color, { readonly, disabled }]" @click="!readonly && !disabled && $emit('click')">
    <span>{{ text }}</span>
    <button v-if="closable && !disabled" type="button" class="os-tag-close" aria-label="close" @click.stop="$emit('close')">
      <OsIcon icon="close" size="xs" />
    </button>
  </div>
</template>
<style scoped>
.os-tag { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; padding: 4px 12px; border-radius: 5px; font-family: Roboto, sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; }
.os-tag.readonly { cursor: default; }
.os-tag.primary { background: var(--os-primary-t-100); color: var(--os-primary-1000); }
.os-tag.grey { background: var(--os-neutral-t-50); color: var(--os-neutral-700); }
.os-tag.blue { background: var(--os-blue-t-100); color: var(--os-blue-1000); }
.os-tag.orange { background: var(--os-orange-t-100); color: var(--os-orange-1000); }
.os-tag.purple { background: var(--os-purple-t-100); color: var(--os-purple-1000); }
.os-tag.green { background: var(--os-green-t-100); color: var(--os-green-1000); }
.os-tag.red { background: var(--os-red-t-100); color: var(--os-red-1000); }
.os-tag.secondary { background: #fff; border: 1px solid currentColor; }
.os-tag-close { display: inline-flex; border: 0; padding: 0; background: none; color: inherit; cursor: pointer; }
.disabled { opacity: 0.4; cursor: default; }
</style>
