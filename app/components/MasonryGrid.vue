<script setup lang="ts" generic="T">
// Cards in columns that stack on their own (masonry), so opening a card pushes down only the cards under it in its
// column, never a whole row. Cards are dealt round-robin (1, 2, 3 across, then 4, 5, 6), so reading order stays
// left to right and a card never jumps to another column when one opens. The column count follows the screen's
// width, Tailwind's breakpoints: `md` 48rem, `lg` 64rem, `2xl` 96rem. The server renders one column; the browser
// sets the count once it knows the width.
const props = defineProps<{
  items: T[];
  itemKey: (item: T) => string;
  columns: Partial<Record<"md" | "lg" | "2xl", number>>;
}>();
defineSlots<{ default(props: { item: T }): unknown }>();

const BREAKPOINTS = { md: 48, lg: 64, "2xl": 96 } as const;
const count = ref(1);
let stop = () => {};
onMounted(() => {
  const queries = (Object.keys(BREAKPOINTS) as (keyof typeof BREAKPOINTS)[])
    .filter((b) => props.columns[b])
    .map((b) => ({
      n: props.columns[b]!,
      mq: window.matchMedia(`(min-width: ${BREAKPOINTS[b]}rem)`),
    }));
  const update = () => (count.value = queries.filter((q) => q.mq.matches).at(-1)?.n ?? 1);
  update();
  for (const q of queries) q.mq.addEventListener("change", update);
  stop = () => queries.forEach((q) => q.mq.removeEventListener("change", update));
});
onBeforeUnmount(() => stop());

const stacks = computed(() =>
  Array.from({ length: count.value }, (_, c) =>
    props.items.filter((_, i) => i % count.value === c),
  ),
);
</script>

<template>
  <div class="flex items-start gap-4">
    <div v-for="(stack, c) in stacks" :key="c" class="flex min-w-0 flex-1 flex-col gap-4">
      <template v-for="item in stack" :key="itemKey(item)">
        <slot :item="item" />
      </template>
    </div>
  </div>
</template>
