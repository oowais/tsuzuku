<script setup lang="ts">
// The card behind Shows, Movies and Log: a `surface-card` (main.css) with a coloured status edge at the start, an
// optional poster backdrop, and the content in the slot. Layout, padding and background come from the caller's
// classes. With `openable` a click anywhere on it, or Enter or Space when it has focus, emits `toggle`, except on its
// buttons and links (mark watched, accept, a source's page) and when the click ends a text selection.
const props = withDefaults(
  defineProps<{
    edge?: "default" | "warning" | "accented" | "error";
    backdrop?: string | null;
    openable?: boolean;
    open?: boolean;
  }>(),
  { edge: "default", backdrop: null, openable: false, open: false },
);
const emit = defineEmits<{ toggle: [] }>();

const EDGE = {
  default: "border-s-default",
  warning: "border-s-warning",
  accented: "border-s-accented",
  error: "border-s-error",
} as const;

function onKey(e: KeyboardEvent) {
  if (!props.openable || e.target !== e.currentTarget) return;
  e.preventDefault();
  emit("toggle");
}
function onClick(e: MouseEvent) {
  if (!props.openable) return;
  if (
    (e.target as HTMLElement).closest(
      'a, button, input, label, [role="checkbox"], [role="menu"], [role="menuitem"]',
    )
  )
    return;
  if (window.getSelection()?.toString()) return;
  emit("toggle");
}
</script>

<template>
  <article
    class="surface-card border border-(--card-border) border-s-4"
    :class="[
      EDGE[edge],
      openable &&
        'cursor-pointer transition-colors hover:bg-elevated/40 focus-visible:outline-2 focus-visible:outline-primary',
    ]"
    :tabindex="openable ? 0 : undefined"
    :aria-expanded="openable ? open : undefined"
    @click="onClick"
    @keydown.enter="onKey"
    @keydown.space="onKey"
  >
    <PosterBackdrop v-if="backdrop" :src="backdrop" :open="open" />
    <slot />
  </article>
</template>
