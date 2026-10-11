<script setup lang="ts">
// Text as a 5x7 dot matrix, like a departure board: lit dots in the current colour, the rest faint.
// Only the characters episode codes use (S, E, digits); anything else is left blank.
const props = defineProps<{ text: string }>();

const GLYPHS: Record<string, string[]> = {
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};
const STEP = 6;

const dots = computed(() =>
  [...props.text.toUpperCase()].flatMap((ch, i) =>
    (GLYPHS[ch] ?? Array<string>(7).fill("00000")).flatMap((row, y) =>
      [...row].map((bit, x) => ({
        x: i * 6 * STEP + x * STEP + 2.5,
        y: y * STEP + 2.5,
        on: bit === "1",
      })),
    ),
  ),
);
const width = computed(() => Math.max(1, props.text.length * 6 * STEP - STEP));
</script>

<template>
  <svg
    :viewBox="`0 0 ${width} ${7 * STEP - 1}`"
    class="h-5 w-auto sm:h-7"
    role="img"
    :aria-label="text"
  >
    <circle
      v-for="(d, i) in dots"
      :key="i"
      :cx="d.x"
      :cy="d.y"
      r="2.3"
      fill="currentColor"
      :opacity="d.on ? 1 : 0.1"
    />
  </svg>
</template>
