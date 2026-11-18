<script setup lang="ts">
import OsPicto from './OsPicto.vue';
defineProps<{ icon?: string; image?: string | { src: string }; primaryText?: string | string[]; secondaryText?: string | string[]; tertiaryText?: string | string[]; disabled?: boolean }>();
const lines = (v?: string | string[]) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
</script>
<template>
  <div class="os-entity" data-testid="os-entity">
    <div v-if="$slots.start || icon || image" class="os-entity-start">
      <slot name="start">
        <div v-if="image" class="os-image os-image-size-m"><img :src="typeof image === 'string' ? image : image.src" alt="" class="ds-entity-image" /></div>
        <OsPicto v-else-if="icon" :icon="icon" :disabled="disabled" />
      </slot>
    </div>
    <div class="os-entity-content-container">
      <div class="os-entity-content">
        <div class="os-text-block" :class="{ disabled }" data-testid="os-text-block">
          <div v-for="(l, i) in lines(primaryText)" :key="'p' + i" class="os-label-l">{{ l }}</div>
          <div v-for="(l, i) in lines(secondaryText)" :key="'s' + i" class="os-label-m">{{ l }}</div>
          <div v-for="(l, i) in lines(tertiaryText)" :key="'t' + i" class="os-label-s">{{ l }}</div>
        </div>
        <slot name="content" />
      </div>
      <div v-if="$slots.sideContent" class="os-entity-side-content"><slot name="sideContent" /></div>
    </div>
    <div v-if="$slots.end" class="os-entity-end"><slot name="end" /></div>
  </div>
</template>
