<script setup lang="ts">
// A card's progress in the look of its card style: a thick glowing track with a marker, a slim
// glowing bar, one segment per episode (the next one glowing), or a ring. Counts are always written out.
const props = defineProps<{
  watched: number;
  episodes: number;
  variant: "track" | "glow" | "segments" | "ring";
}>();
const pct = computed(() =>
  props.episodes ? Math.round((props.watched / props.episodes) * 100) : 0,
);
const left = computed(() => props.episodes - props.watched);
// Past this many episodes the segments get too thin to read, so a long show gets the glowing bar.
const MAX_SEGMENTS = 60;
const glow = "box-shadow: 0 0 12px color-mix(in oklab, var(--ui-primary) 55%, transparent)";
</script>

<template>
  <div v-if="variant === 'ring'" class="flex items-center gap-2">
    <svg viewBox="0 0 36 36" class="size-12 shrink-0 -rotate-90" aria-hidden="true">
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
        style="filter: drop-shadow(0 0 4px color-mix(in oklab, var(--ui-primary) 60%, transparent))"
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
    <div
      v-else-if="variant === 'segments' && episodes <= MAX_SEGMENTS"
      class="grid flex-1 gap-0.5"
      :style="{ gridTemplateColumns: `repeat(${episodes}, minmax(0, 1fr))` }"
      aria-hidden="true"
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
    <div v-else class="h-2 flex-1 overflow-hidden rounded-full bg-accented" aria-hidden="true">
      <div class="h-full rounded-full bg-primary" :style="`width: ${pct}%; ${glow}`" />
    </div>
    <span class="tabular-nums whitespace-nowrap"
      >{{ watched }}/{{ episodes }}<template v-if="left"> · {{ left }} left</template></span
    >
  </div>
</template>
