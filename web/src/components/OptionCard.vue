<script setup lang="ts">
import { OsButton, OsCardLayout, OsPicto } from '@onestock-public/design-system';
import { t } from '../i18n';
/** Option block of the tester ("Sales channel", "Destination", "Order price"...). `optional` blocks have an Add/Remove toggle. */
defineProps<{ icon: string; title: string; subtitle: string; optional?: boolean; active?: boolean }>();
defineEmits<{ toggle: [boolean] }>();
</script>
<template>
  <OsCardLayout>
    <div class="option-card">
      <div class="head">
        <OsPicto :icon="icon" :color="!optional || active ? 'primary' : 'grey'" />
        <div class="texts">
          <span class="os-label-l">{{ title }}</span>
          <span class="os-label-s os-text-secondary">{{ subtitle }}</span>
        </div>
        <OsButton v-if="optional && !active" type="secondary" :text="t('add')" @click="$emit('toggle', true)" />
        <OsButton v-else-if="optional" type="tertiary" icon="trash" :aria-label="t('remove')" @click="$emit('toggle', false)" />
      </div>
      <div v-if="!optional || active" class="body"><slot /></div>
    </div>
  </OsCardLayout>
</template>
<style scoped>
.option-card { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: center; gap: 16px; }
.texts { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.texts .os-label-l { color: var(--os-text-primary); }
.body { padding-left: 64px; }
@media (max-width: 640px) { .body { padding-left: 0; } }
</style>
