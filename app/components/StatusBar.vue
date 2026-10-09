<script setup lang="ts">
// How a source's list splits by status, as one stacked bar (part of a whole), with a legend that always
// shows each status and its count, so nothing depends on colour or hover alone.
const props = defineProps<{ parts: { key: string, label: string, value: number }[] }>()
const total = computed(() => props.parts.reduce((n, p) => n + p.value, 0))
const shown = computed(() => props.parts.filter(p => p.value > 0))
const pct = (v: number) => total.value ? Math.round(v / total.value * 100) : 0
</script>

<template>
  <div class="space-y-2">
    <div
      v-if="total"
      class="flex h-3 w-full gap-[2px]"
      role="img"
      :aria-label="shown.map(p => `${p.label} ${p.value}`).join(', ')"
    >
      <UTooltip
        v-for="p in shown"
        :key="p.key"
        :text="`${p.value} ${p.label.toLowerCase()} · ${pct(p.value)}%`"
      >
        <span
          tabindex="0"
          class="block h-full min-w-1 first:rounded-s last:rounded-e transition-opacity hover:opacity-80 focus-visible:opacity-80 focus-visible:outline-2 outline-offset-2 outline-primary"
          :style="{ flexGrow: p.value, flexBasis: 0, background: `var(--list-${p.key})` }"
        />
      </UTooltip>
    </div>
    <ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <li
        v-for="p in parts"
        :key="p.key"
        class="inline-flex items-center gap-1.5"
      >
        <span
          class="size-2.5 rounded-xs"
          :style="{ background: `var(--list-${p.key})` }"
          aria-hidden="true"
        />
        {{ p.label }}
        <span class="font-medium text-default">{{ p.value.toLocaleString('en-GB') }}</span>
      </li>
    </ul>
  </div>
</template>
