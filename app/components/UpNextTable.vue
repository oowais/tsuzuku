<script setup lang="ts">
// Rows of shows with one column per source. A row whose sources differ is marked on the left.
defineProps<{
  rows: {
    key: string
    title: string
    kind: string
    differs: boolean
    cells: Partial<Record<'trakt' | 'simkl' | 'mal', InstanceType<typeof import('./UpNextCell.vue').default>['$props']['cell']>>
  }[]
}>()
const COLUMNS = ['trakt', 'simkl', 'mal'] as const
</script>

<template>
  <div class="rounded-md border border-default divide-y divide-default">
    <div class="hidden sm:grid grid-cols-[minmax(10rem,1.2fr)_repeat(3,minmax(0,1fr))] gap-4 px-4 py-2 text-xs font-medium text-muted">
      <span>Show</span>
      <span
        v-for="c in COLUMNS"
        :key="c"
      >{{ SOURCE_LABELS[c] }}</span>
    </div>
    <div
      v-for="row in rows"
      :key="row.key"
      class="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,1.2fr)_repeat(3,minmax(0,1fr))] sm:gap-4 border-s-4"
      :class="row.differs ? 'border-s-warning' : 'border-s-transparent'"
    >
      <div class="font-medium">
        {{ row.title }}
      </div>
      <UpNextCell
        v-for="c in COLUMNS"
        :key="c"
        :cell="row.cells[c]"
        :kind="row.kind"
      />
    </div>
    <div
      v-if="!rows.length"
      class="px-4 py-3 text-sm text-muted"
    >
      Nothing here.
    </div>
  </div>
</template>
