<script setup lang="ts">
// Marks a source took over the last 30 calendar days in the browser's time zone, one column per day (oldest left,
// today right), one hue (more is taller). A day with a failed mark gets a status dot under its column; every column
// says its counts on hover and focus. Rendered in the browser only (the server has no time zone).
const props = defineProps<{ marks: { at: string; ok: boolean }[] }>();
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const days = computed(() => {
  const today = new Date();
  const list = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (29 - i));
    return { key: dayKey(d), ok: 0, failed: 0 };
  });
  const byKey = new Map(list.map((d) => [d.key, d]));
  for (const m of props.marks) {
    const d = byKey.get(dayKey(new Date(m.at)));
    if (d) d[m.ok ? "ok" : "failed"]++;
  }
  return list;
});
const max = computed(() => Math.max(1, ...days.value.map((d) => d.ok)));
const ago = (i: number) => {
  const n = days.value.length - 1 - i;
  return n === 0 ? "Today" : n === 1 ? "Yesterday" : `${n} days ago`;
};
const describe = (d: { ok: number; failed: number }, i: number) =>
  `${ago(i)}: ${d.ok} ${d.ok === 1 ? "mark" : "marks"}${d.failed ? `, ${d.failed} failed` : ""}`;
</script>

<template>
  <div>
    <div
      class="flex h-16 items-end gap-[2px]"
      role="img"
      :aria-label="days.map(describe).join('; ')"
    >
      <UTooltip v-for="(d, i) in days" :key="i" :text="describe(d, i)">
        <div
          tabindex="0"
          class="flex h-full flex-1 flex-col justify-end outline-offset-2 outline-primary focus-visible:outline-2"
        >
          <span
            class="block w-full rounded-t transition-opacity hover:opacity-80"
            :style="{
              height: `${d.ok ? Math.max(8, (d.ok / max) * 100) : 0}%`,
              background: 'var(--chart-sequential)',
            }"
          />
        </div>
      </UTooltip>
    </div>
    <div class="flex h-3.5 gap-[2px] border-t border-default pt-1">
      <span v-for="(d, i) in days" :key="i" class="flex flex-1 justify-center">
        <span v-if="d.failed" class="size-1.5 rounded-full bg-error" />
      </span>
    </div>
    <div class="mt-0.5 flex justify-between text-xs text-dimmed">
      <span>30 days ago</span>
      <span>today</span>
    </div>
  </div>
</template>
