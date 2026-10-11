<script setup lang="ts">
// The poster behind a card (Shows' Poster backdrop style, and Movies), under a veil that keeps the text readable.
// How it is drawn comes from the --poster-* tokens in main.css: by default a small copy, blurred and scaled up 4x
// (the same look as blurring the whole card, for a sixteenth of the pixels, so a long list scrolls smoothly) under a
// fade to the page colour; a theme can swap that for the poster sharp under frosted glass.
defineProps<{ src: string | null }>();
</script>

<template>
  <ClientOnly v-if="src">
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 overflow-hidden [contain:paint]"
    >
      <img :src="src" alt="" referrerpolicy="no-referrer" class="poster" />
      <div class="veil" />
    </div>
  </ClientOnly>
</template>

<style scoped>
.poster {
  position: absolute;
  top: var(--poster-inset);
  left: var(--poster-inset);
  width: var(--poster-size);
  height: var(--poster-size);
  transform-origin: top left;
  scale: var(--poster-scale);
  object-fit: cover;
  filter: var(--poster-filter);
  opacity: var(--poster-opacity);
}
.veil {
  position: absolute;
  inset: 0;
  background: var(--poster-veil);
  backdrop-filter: var(--poster-veil-filter);
  mask-image: var(--poster-veil-mask);
}
</style>
