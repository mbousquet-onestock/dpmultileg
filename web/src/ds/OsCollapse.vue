<script setup lang="ts">
import OsIcon from './OsIcon.vue';
const props = withDefaults(defineProps<{ modelValue?: boolean; icon?: 'chevron' | 'arrow-drop'; readonly?: boolean }>(), { icon: 'chevron' });
const emit = defineEmits<{ 'update:modelValue': [boolean]; click: [Event] }>();
function onClick(e: Event) {
  if (props.readonly) return;
  emit('click', e);
  emit('update:modelValue', !props.modelValue);
}
</script>
<template>
  <div class="os-collapse">
    <div class="os-collapse-header" :class="{ readonly }" role="button" :aria-expanded="!!modelValue" tabindex="0" @click="onClick" @keydown.enter="onClick">
      <div class="grow"><slot name="header" /></div>
      <OsIcon v-if="!readonly" :icon="icon === 'chevron' ? (modelValue ? 'chevron-up' : 'chevron-down') : modelValue ? 'arrow-drop-up' : 'arrow-drop-down'" color="secondary" />
    </div>
    <div v-if="modelValue" class="os-collapse-content"><slot name="content" /></div>
  </div>
</template>
<style scoped>
.os-collapse-header { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; }
.os-collapse-header.readonly { cursor: default; }
.grow { flex: 1; min-width: 0; }
.os-collapse-content { padding-top: 8px; }
</style>
