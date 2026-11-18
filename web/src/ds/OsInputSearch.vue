<script setup lang="ts">
import OsField from './OsField.vue';
import OsIcon from './OsIcon.vue';
defineProps<{ modelValue?: string; label?: string; placeholder?: string; pending?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [string]; blur: []; focus: [] }>();
</script>
<template>
  <OsField :label="label">
    <div class="os-input-text" data-testid="os-input-text">
      <input
        class="os-input-text-field placeholder-ellipsis"
        data-testid="os-input-text-field"
        type="text"
        :value="modelValue ?? ''"
        :placeholder="placeholder"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @blur="emit('blur')"
        @focus="emit('focus')"
      />
    </div>
    <template #end>
      <div
        v-if="modelValue && !pending"
        role="button"
        tabindex="0"
        aria-label="clear"
        class="os-input-group-child os-input-group-child-action os-input-group-end border-end"
        @click.prevent="emit('update:modelValue', '')"
      >
        <div class="content"><OsIcon icon="close" size="s" /></div>
      </div>
      <div v-else class="os-input-group-child os-input-group-child-info os-input-group-end border-end">
        <div class="content"><OsIcon :icon="pending ? 'loader' : 'search'" size="s" :rotation="pending" class="icon" /></div>
      </div>
    </template>
  </OsField>
</template>
