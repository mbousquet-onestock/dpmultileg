<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import OsButton from './OsButton.vue';
const props = withDefaults(defineProps<{ title: string; visible?: boolean; size?: 'm' | 'l' | 'dynamic' }>(), { size: 'm' });
const emit = defineEmits<{ 'update:visible': [boolean] }>();
const onKey = (e: KeyboardEvent) => props.visible && e.key === 'Escape' && emit('update:visible', false);
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>
<template>
  <Teleport to="body">
    <div v-if="visible" class="os-modal-overlay" data-testid="os-modal-overlay" @mousedown.self="emit('update:visible', false)">
      <div class="os-modal" :class="`os-modal-size-${size}`" role="dialog" tabindex="-1" aria-modal="true" :aria-label="title" data-testid="os-modal">
        <div class="os-modal-header" data-testid="os-modal-header">
          <span class="os-modal-header-title os-label-l">{{ title }}</span>
          <OsButton type="tertiary" icon="close" aria-label="close" @click="emit('update:visible', false)" />
        </div>
        <div class="os-modal-content" data-testid="os-modal-content"><slot /></div>
        <div v-if="$slots.primaryActions || $slots.secondaryActions" class="os-modal-footer">
          <div class="os-modal-footer-secondary"><slot name="secondaryActions" /></div>
          <div class="os-modal-footer-primary"><slot name="primaryActions" /></div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
