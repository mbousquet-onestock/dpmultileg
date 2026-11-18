<script setup lang="ts">
import { ref } from 'vue';
import OsButton from './OsButton.vue';
const props = withDefaults(defineProps<{ modelValue?: boolean; icon?: 'chevron' | 'arrow-drop'; readonly?: boolean }>(), { icon: 'chevron' });
const emit = defineEmits<{ 'update:modelValue': [boolean]; click: [Event] }>();
const hovered = ref(false);
function onClick(e: Event) {
  if (props.readonly) return;
  emit('click', e);
  emit('update:modelValue', !props.modelValue);
}
</script>
<template>
  <div>
    <div
      class="os-collapse-header"
      :class="{ 'os-collapse-hovered': hovered && !readonly }"
      data-testid="os-collapse-header"
      role="button"
      :aria-expanded="!!modelValue"
      tabindex="0"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @click="onClick"
      @keydown.enter="onClick"
    >
      <div class="os-collapse-header-slot"><slot name="header" /></div>
      <OsButton
        v-if="!readonly"
        type="tertiary"
        :icon="icon === 'chevron' ? 'chevron-down' : 'arrow-drop-down'"
        class="os-collapse-header-button"
        :class="{ 'os-collapse-header-button-rotated': modelValue }"
        tabindex="-1"
        @click.stop="onClick"
      />
    </div>
    <div class="os-collapse-content" :class="{ 'os-collapse-content-open': modelValue }" data-testid="os-collapse-content">
      <div class="os-collapse-content-slot"><slot v-if="modelValue" name="content" /></div>
    </div>
  </div>
</template>
