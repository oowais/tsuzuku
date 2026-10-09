<script setup lang="ts">
// How many ratings of 1 to 10 you gave: one column per score, one hue (more is taller). The busiest score
// is labelled; every column shows its count on hover and focus.
const props = defineProps<{ counts: number[] }>()
const max = computed(() => Math.max(1, ...props.counts))
const top = computed(() => props.counts.indexOf(Math.max(...props.counts)))
</script>

<template>
  <div>
    <div
      class="mt-5 flex h-24 items-end gap-[2px]"
      role="img"
      :aria-label="counts.map((c, i) => `${i + 1}: ${c}`).join(', ')"
    >
      <UTooltip
        v-for="(c, i) in counts"
        :key="i"
        :text="`${c} rated ${i + 1}`"
      >
        <div
          tabindex="0"
          class="relative flex h-full flex-1 items-end outline-offset-2 outline-primary focus-visible:outline-2"
        >
          <span
            v-if="i === top && c"
            class="absolute inset-x-0 -translate-y-full pb-0.5 text-center text-xs font-medium text-default"
            :style="{ bottom: `${c / max * 100}%` }"
          >{{ c }}</span>
          <span
            class="block w-full rounded-t transition-opacity hover:opacity-80"
            :style="{ height: `${Math.max(c ? 4 : 0, c / max * 100)}%`, background: 'var(--chart-sequential)' }"
          />
        </div>
      </UTooltip>
    </div>
    <div class="mt-1 flex gap-[2px] border-t border-default pt-1 text-center text-xs text-dimmed tabular-nums">
      <span
        v-for="(_, i) in counts"
        :key="i"
        class="flex-1"
      >{{ i + 1 }}</span>
    </div>
  </div>
</template>
