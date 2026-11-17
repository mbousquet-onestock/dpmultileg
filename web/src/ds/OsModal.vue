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
    <div v-if="visible" class="os-modal-backdrop" @mousedown.self="emit('update:visible', false)">
      <div class="os-modal os-shadow-floating-container" :class="`size-${size}`" role="dialog" aria-modal="true" :aria-label="title">
        <header>
          <span class="os-title-m">{{ title }}</span>
          <OsButton type="tertiary" color="neutral" icon="close" aria-label="close" @click="emit('update:visible', false)" />
        </header>
        <div class="os-modal-content"><slot /></div>
        <footer v-if="$slots.primaryActions || $slots.secondaryActions">
          <div><slot name="secondaryActions" /></div>
          <div class="right"><slot name="primaryActions" /></div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
<style scoped>
.os-modal-backdrop { position: fixed; inset: 0; z-index: 100; background: #00000066; display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px; }
.os-modal { background: #fff; border-radius: 7px; display: flex; flex-direction: column; max-height: calc(100vh - 96px); width: 100%; }
.size-m { max-width: 560px; } .size-l { max-width: 880px; } .size-dynamic { width: auto; max-width: calc(100vw - 32px); }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 8px 24px; }
.os-modal-content { padding: 8px 24px 16px; overflow-y: auto; }
footer { display: flex; justify-content: space-between; gap: 8px; padding: 12px 24px; border-top: 1px solid var(--os-border); }
footer .right { display: flex; gap: 8px; }
</style>
