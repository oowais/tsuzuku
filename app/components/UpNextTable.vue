<script setup lang="ts">
// Rows of shows with one column per source. A row whose sources differ is marked on the left.
defineProps<{
  rows: {
    key: string
    title: string
    kind: string
    differs: boolean
    images: string[]
    cells: Partial<Record<'trakt' | 'simkl' | 'mal', InstanceType<typeof import('./UpNextCell.vue').default>['$props']['cell']>>
  }[]
}>()
const COLUMNS = ['trakt', 'simkl', 'mal'] as const

// Images that failed to load, so the next candidate is tried (a source's image server can refuse).
const failed = reactive(new Set<string>())
const imageFor = (images: string[] | undefined) => images?.find(u => !failed.has(u)) ?? null
</script>

<template>
  <div class="rounded-md border border-default divide-y divide-default">
    <div class="hidden sm:grid grid-cols-[minmax(16rem,1.4fr)_repeat(3,minmax(0,1fr))] gap-4 px-4 py-2 text-xs font-medium text-muted">
      <span>Show</span>
      <span
        v-for="c in COLUMNS"
        :key="c"
      >{{ SOURCE_LABELS[c] }}</span>
    </div>
    <div
      v-for="row in rows"
      :key="row.key"
      class="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(16rem,1.4fr)_repeat(3,minmax(0,1fr))] sm:gap-4 border-s-4"
      :class="row.differs ? 'border-s-warning' : 'border-s-transparent'"
    >
      <div class="flex items-start gap-3 font-medium">
        <!-- Client-only: an image that fails while the server-rendered page loads would otherwise fail
             before the error handler exists, and the next image would never be tried. -->
        <ClientOnly>
          <img
            v-if="imageFor(row.images)"
            :src="imageFor(row.images)!"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            class="w-20 h-30 sm:w-28 sm:h-42 shrink-0 rounded object-cover bg-elevated"
            @error="failed.add(imageFor(row.images)!)"
          >
          <div
            v-else
            class="w-20 h-30 sm:w-28 sm:h-42 shrink-0 rounded bg-elevated"
          />
          <template #fallback>
            <div class="w-20 h-30 sm:w-28 sm:h-42 shrink-0 rounded bg-elevated" />
          </template>
        </ClientOnly>
        <span>{{ row.title }}</span>
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
