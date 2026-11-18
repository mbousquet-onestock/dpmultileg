<script setup lang="ts">
import { computed } from 'vue';
import OsIcon from './OsIcon.vue';
type Color = 'primary' | 'red' | 'orange' | 'blue' | 'neutral' | 'white-transparent';
const props = withDefaults(
  defineProps<{ text?: string; type?: 'primary' | 'secondary' | 'tertiary'; color?: Color; icon?: string | { name: string; position?: 'start' | 'end' }; disabled?: boolean; pending?: boolean }>(),
  { type: 'primary', color: 'primary' },
);
defineEmits<{ click: [MouseEvent] }>();
const iconName = computed(() => (typeof props.icon === 'string' ? props.icon : props.icon?.name));
const iconEnd = computed(() => typeof props.icon === 'object' && props.icon?.position === 'end');
const layout = computed(() => (!props.text ? 'os-button-icon-only' : !iconName.value ? 'os-button-text-only' : iconEnd.value ? 'os-button-icon-end' : 'os-button-icon-start'));
</script>
<template>
  <button
    type="button"
    class="os-button"
    :class="[type, `os-button-${type}-${color}`, layout, { pending, disabled }]"
    :disabled="disabled || pending"
    data-testid="os-button"
    @click="$emit('click', $event)"
  >
    <OsIcon v-if="iconName && !iconEnd" :icon="iconName" size="s" class="os-button-icon-left" :class="{ hidden: pending }" />
    <div v-if="text" class="os-button-text" :class="{ hidden: pending }">{{ text }}</div>
    <OsIcon v-if="iconName && iconEnd" :icon="iconName" size="s" class="os-button-icon-right" :class="{ hidden: pending }" />
    <OsIcon v-if="pending" icon="loader" size="s" rotation class="os-button-icon-loader" />
  </button>
</template>
