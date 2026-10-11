<script setup lang="ts">
// A card's progress in the look of its card style: a thick glowing track with a marker, one segment per
// episode (the next one glowing), or a ring. Counts are always written out.
const props = defineProps<{
  watched: number;
  episodes: number;
  variant: "track" | "segments" | "ring";
}>();
const pct = computed(() =>
  props.episodes ? Math.round((props.watched / props.episodes) * 100) : 0,
);
const left = computed(() => props.episodes - props.watched);
// Segments narrower than this (gap included) are too thin to read, so a show with more episodes than its bar
// has room for gets the glowing bar instead. The bar's width is measured in the browser, so the same show can
// get segments on a wide card and the bar on a phone. Until it is measured (server render), a phone-width bar
// is assumed, so a phone never flashes slivers.
const MIN_SEGMENT_PX = 6;
const ASSUMED_WIDTH_PX = 240;
const slot = ref<HTMLElement | null>(null);
const width = ref<number | null>(null);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!slot.value) return;
  observer = new ResizeObserver(([entry]) => {
    width.value = entry!.contentRect.width;
  });
  observer.observe(slot.value);
});
onBeforeUnmount(() => observer?.disconnect());
const segmentsFit = computed(
  () => (width.value ?? ASSUMED_WIDTH_PX) / props.episodes >= MIN_SEGMENT_PX,
);
const glow = "box-shadow: 0 0 12px var(--card-glow)";
</script>

<template>
  <div v-if="variant === 'ring'" class="flex items-center gap-2">
    <!-- overflow-visible: else the svg's box clips the glow into a visible square. -->
    <svg
      viewBox="0 0 36 36"
      class="size-12 shrink-0 -rotate-90 overflow-visible"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="15" fill="none" stroke-width="4" class="stroke-(--ui-bg)" />
      <circle
        cx="18"
        cy="18"
        r="15"
        fill="none"
        stroke-width="4"
        stroke-linecap="round"
        pathLength="100"
        :stroke-dasharray="`${pct} 100`"
        class="stroke-primary"
        style="filter: drop-shadow(0 0 4px var(--card-glow))"
      />
    </svg>
    <span class="text-xs tabular-nums whitespace-nowrap">
      <span class="block text-default">{{ watched }}/{{ episodes }}</span>
      <span v-if="left" class="block text-dimmed">{{ left }} left</span>
    </span>
  </div>

  <div v-else class="flex items-center gap-3 text-xs text-muted">
    <div
      v-if="variant === 'track'"
      class="relative h-8 flex-1 overflow-hidden rounded-full border border-default bg-elevated"
      aria-hidden="true"
    >
      <div
        class="absolute inset-y-0 start-0 rounded-full bg-linear-to-r from-primary/40 to-primary"
        :style="`width: max(2rem, ${pct}%); ${glow}`"
      />
      <span
        class="absolute top-1 flex size-6 items-center justify-center rounded-full bg-(--ui-bg)/85 text-primary"
        :style="{ left: `calc(max(2rem, ${pct}%) - 1.75rem)` }"
      >
        <UIcon name="i-lucide-play" class="size-3.5" />
      </span>
    </div>
    <div v-else ref="slot" class="min-w-0 flex-1" aria-hidden="true">
      <div
        v-if="segmentsFit"
        class="grid gap-0.5"
        :style="{ gridTemplateColumns: `repeat(${episodes}, minmax(0, 1fr))` }"
      >
        <span
          v-for="i in episodes"
          :key="i"
          class="h-2.5 rounded-sm"
          :class="
            i <= watched
              ? 'bg-primary/45'
              : i === watched + 1
                ? 'bg-primary animate-pulse'
                : 'bg-accented'
          "
          :style="i === watched + 1 ? glow : undefined"
        />
      </div>
      <div v-else class="h-2 overflow-hidden rounded-full bg-accented">
        <div class="h-full rounded-full bg-primary" :style="`width: ${pct}%; ${glow}`" />
      </div>
    </div>
    <span class="tabular-nums whitespace-nowrap"
      >{{ watched }}/{{ episodes }}<template v-if="left"> · {{ left }} left</template></span
    >
  </div>
</template>
