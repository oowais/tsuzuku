<script setup lang="ts">
// A show's or movie's poster: the first of its images that loads, else an empty frame. `lg` is Shows' size, `xl`
// Up Next's hero tile, `md` Movies' and Log's; the corners are the theme's --poster-radius-lg / -md (main.css).
const props = withDefaults(
  defineProps<{ images: string[] | undefined; size?: "xl" | "lg" | "md" }>(),
  {
    size: "md",
  },
);
const { imageFor, fail } = usePosterImage();
const src = computed(() => imageFor(props.images));
const SIZE = {
  xl: "w-32 h-48 sm:w-52 sm:h-78 rounded-(--poster-radius-lg)",
  lg: "w-28 h-42 sm:w-40 sm:h-60 rounded-(--poster-radius-lg)",
  md: "h-30 w-20 sm:h-36 sm:w-24 rounded-(--poster-radius-md)",
} as const;
</script>

<template>
  <!-- Client-only: an image that fails while the server-rendered page loads would otherwise fail before the error
       handler exists, and the next image would never be tried. -->
  <ClientOnly>
    <img
      v-if="src"
      :src="src"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      class="shrink-0 object-cover bg-elevated"
      :class="SIZE[size]"
      @error="fail(src)"
    />
    <div v-else class="shrink-0 bg-elevated" :class="SIZE[size]" />
    <template #fallback>
      <div class="shrink-0 bg-elevated" :class="SIZE[size]" />
    </template>
  </ClientOnly>
</template>
