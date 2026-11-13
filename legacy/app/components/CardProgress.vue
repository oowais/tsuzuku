<script setup lang="ts">
// A card's progress under it, for the progress styles drawn there (progress-styles.ts): one segment per episode
// (the next one glowing), a big count over a thin bar, or watched then whether the next episode is out. Counts are
// always written out. The other styles are drawn on the card itself (UpNextCards).
const props = defineProps<{
  watched: number;
  episodes: number;
  variant: "segments" | "number" | "aired";
  // Aired look: whether the next episode is out (else it is still to air).
  nextAired?: boolean;
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
  <!-- Big number: the count leads, the bar under it is a footnote. -->
  <div v-if="variant === 'number'" class="text-xs text-muted">
    <div class="flex items-baseline gap-1.5 tabular-nums">
      <span class="text-3xl font-extrabold leading-none text-highlighted">{{ watched }}</span>
      <span class="text-sm">/ {{ episodes }}</span>
      <span v-if="left" class="ms-auto">{{ left }} left</span>
    </div>
    <div class="mt-2 h-1 overflow-hidden rounded-full bg-accented" aria-hidden="true">
      <div class="h-full rounded-full bg-primary" :style="{ width: `${pct}%` }" />
    </div>
  </div>

  <!-- Aired: watched, the next one out (warning) or still to air, and the rest dimmed. Only the next episode's air
       date is known today, so the rest is "not known yet", not "not aired". -->
  <div v-else-if="variant === 'aired'" ref="slot" class="space-y-1.5 text-xs text-muted">
    <div
      v-if="segmentsFit"
      class="grid gap-[3px]"
      :style="{ gridTemplateColumns: `repeat(${episodes}, minmax(0, 1fr))` }"
      aria-hidden="true"
    >
      <span
        v-for="i in episodes"
        :key="i"
        class="h-2.5 rounded-sm"
        :class="
          i <= watched
            ? 'bg-primary'
            : i === watched + 1
              ? nextAired
                ? 'bg-warning'
                : 'border border-dashed border-warning'
              : 'bg-accented/60'
        "
      />
    </div>
    <div v-else class="h-2.5 overflow-hidden rounded-full bg-accented/60" aria-hidden="true">
      <div class="h-full bg-primary" :style="{ width: `${pct}%` }" />
    </div>
    <span class="block tabular-nums"
      >{{ watched }} watched<template v-if="left">
        · next {{ nextAired ? "is out" : "not aired yet" }} · {{ left }} left</template
      ></span
    >
  </div>

  <div v-else class="flex items-center gap-3 text-xs text-muted">
    <div ref="slot" class="min-w-0 flex-1" aria-hidden="true">
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
