<script setup lang="ts">
import OsIcon from './OsIcon.vue';
withDefaults(defineProps<{ text: string; color?: string; type?: 'primary' | 'secondary'; closable?: boolean; disabled?: boolean; readonly?: boolean }>(), {
  color: 'primary',
  type: 'primary',
});
defineEmits<{ click: []; close: [] }>();
</script>
<template>
  <div class="os-tag" :class="[type, color, { readonly, disabled }]" data-testid="os-tag" @click="!readonly && !disabled && $emit('click')">
    <span>{{ text }}</span>
    <div v-if="closable && !disabled" role="button" class="closable-container" tabindex="0" aria-label="close" @click.stop="$emit('close')">
      <OsIcon icon="close" size="xs" />
    </div>
  </div>
</template>
