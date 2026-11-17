import { onBeforeUnmount, onMounted, type Ref } from 'vue';
export function useClickOutside(el: Ref<HTMLElement | null | undefined>, cb: () => void) {
  const handler = (e: MouseEvent) => {
    if (el.value && !el.value.contains(e.target as Node)) cb();
  };
  onMounted(() => document.addEventListener('mousedown', handler));
  onBeforeUnmount(() => document.removeEventListener('mousedown', handler));
}
