<script setup lang="ts">
import { episodeLabel } from '#shared/utils/source-links'

// Rows of shows with one column per source. A row whose sources differ is marked on the left, and can be
// accepted: it stays visible but is no longer flagged until any source moves.
defineProps<{
  rows: {
    key: string
    title: string
    kind: string
    differs: boolean
    accepted: boolean
    agrees: boolean
    signature: string
    images: string[]
    cells: Partial<Record<'trakt' | 'simkl' | 'mal', InstanceType<typeof import('./UpNextCell.vue').default>['$props']['cell']>>
  }[]
}>()
const emit = defineEmits<{ accepted: [key: string, accepted: boolean], mark: [row: { key: string, title: string }, source?: 'trakt' | 'simkl' | 'mal'] }>()
const COLUMNS = ['trakt', 'simkl', 'mal'] as const
const toast = useToast()

// The episode a row-wide "mark watched" covers, as the first agreeing source shows it (Trakt when it is there).
function agreedEpisode(row: { cells: Partial<Record<string, { state: string, traktNext: { season: number | null, number: number } | null, entry: { next: { season: number | null, number: number } | null } | null }>> }) {
  const c = COLUMNS.map(s => row.cells[s]).find(c => c?.state === 'in_sync')
  return episodeLabel(c?.traktNext ?? c?.entry?.next ?? null)
}

const busy = ref<string | null>(null)
async function setAccepted(row: { key: string, signature: string }, accepted: boolean) {
  busy.value = row.key
  try {
    if (accepted) await $fetch('/api/up-next/accept', { method: 'POST', body: { rowKey: row.key, signature: row.signature } })
    else await $fetch('/api/up-next/undo-accept', { method: 'POST', body: { rowKey: row.key } })
    emit('accepted', row.key, accepted)
  } catch (e) {
    toast.add({ title: 'Could not save', description: String((e as Error).message), color: 'error' })
  } finally {
    busy.value = null
  }
}

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
      :class="row.differs && !row.accepted ? 'border-s-warning' : row.accepted ? 'border-s-accented' : 'border-s-transparent'"
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
        <div class="min-w-0 flex flex-col items-start gap-2">
          <span>{{ row.title }}</span>
          <UButton
            v-if="row.agrees"
            label="Mark watched"
            :title="`Mark ${agreedEpisode(row)} watched on every source`"
            icon="i-lucide-check-check"
            variant="soft"
            size="sm"
            class="max-w-full"
            @click="emit('mark', row)"
          />
          <UButton
            v-if="row.differs && !row.accepted"
            label="Accept difference"
            icon="i-lucide-check"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="busy === row.key"
            @click="setAccepted(row, true)"
          />
          <div
            v-else-if="row.accepted"
            class="flex flex-wrap items-center gap-1 text-xs font-normal text-muted"
          >
            Difference accepted ·
            <UButton
              label="Undo"
              color="neutral"
              variant="link"
              size="xs"
              class="p-0"
              :loading="busy === row.key"
              @click="setAccepted(row, false)"
            />
          </div>
        </div>
      </div>
      <UpNextCell
        v-for="c in COLUMNS"
        :key="c"
        :cell="row.cells[c]"
        :kind="row.kind"
        :accepted="row.accepted"
        :markable="!row.agrees"
        @mark="emit('mark', row, c)"
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
