<script setup lang="ts">
import OsPicto from './OsPicto.vue';
defineProps<{ icon?: string; image?: string | { src: string }; primaryText?: string | string[]; secondaryText?: string | string[]; tertiaryText?: string | string[]; disabled?: boolean }>();
const lines = (v?: string | string[]) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
</script>
<template>
  <div class="os-entity" :class="{ disabled }">
    <div v-if="$slots.start || icon || image" class="os-entity-start">
      <slot name="start">
        <img v-if="image" :src="typeof image === 'string' ? image : image.src" alt="" class="os-entity-image" />
        <OsPicto v-else-if="icon" :icon="icon" />
      </slot>
    </div>
    <div class="os-entity-content">
      <div class="os-text-block">
        <div v-for="(l, i) in lines(primaryText)" :key="'p' + i" class="os-label-l">{{ l }}</div>
        <div v-for="(l, i) in lines(secondaryText)" :key="'s' + i" class="os-label-m">{{ l }}</div>
        <div v-for="(l, i) in lines(tertiaryText)" :key="'t' + i" class="os-label-s os-text-secondary">{{ l }}</div>
      </div>
      <slot name="content" />
    </div>
    <div v-if="$slots.end" class="os-entity-end"><slot name="end" /></div>
  </div>
</template>
<style scoped>
.os-entity { display: flex; align-items: center; gap: 12px; color: var(--os-text-primary); min-width: 0; }
.os-entity-content { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.os-text-block { display: flex; flex-direction: column; min-width: 0; }
.os-text-block > div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.os-entity-image { width: 48px; height: 48px; border-radius: 5px; object-fit: cover; }
.os-entity-end { display: flex; align-items: center; gap: 4px; }
.disabled { opacity: 0.4; }
</style>
