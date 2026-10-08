<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { LinkItem } from '~/utils/entry-view'

// Every stored link, one row per anime entry or show, with edit and unlink (local database only).
export interface LinkRow {
  key: string
  kind: 'anime' | 'show'
  mappingId: number
  seasonId: number | null
  status: 'auto' | 'confirmed' | 'rejected'
  trakt: { id: number, title: string, url: string | null } | null
  traktSeason: number | null
  traktSeasonUrl: string | null
  episodeOffset: number
  entry: { title: string, links: LinkItem[] }
}

const props = defineProps<{ rows: LinkRow[] }>()
const emit = defineEmits<{ changed: [] }>()
const toast = useToast()

const tab = ref<'anime' | 'show' | 'rejected'>('anime')
const counts = computed(() => ({
  anime: props.rows.filter(r => r.kind === 'anime').length,
  show: props.rows.filter(r => r.kind === 'show' && r.status !== 'rejected').length,
  rejected: props.rows.filter(r => r.status === 'rejected').length
}))
const tabs = computed(() => [
  { label: `Anime (${counts.value.anime})`, value: 'anime' },
  { label: `Shows (${counts.value.show})`, value: 'show' },
  ...(counts.value.rejected ? [{ label: `Unlinked shows (${counts.value.rejected})`, value: 'rejected' }] : [])
])
const shown = computed(() => props.rows.filter(r => tab.value === 'rejected'
  ? r.status === 'rejected'
  : r.kind === tab.value && r.status !== 'rejected'))

const columns = computed<TableColumn<LinkRow>[]>(() => [
  { id: 'trakt', header: 'Trakt show' },
  ...(tab.value === 'anime' ? [{ id: 'season', header: 'Trakt season' }, { id: 'offset', header: 'Offset' }] : []),
  { id: 'entry', header: tab.value === 'anime' ? 'Simkl / MAL entry' : 'Simkl show' },
  { id: 'how', header: 'How' },
  { id: 'actions', header: '' }
])

// One row edited or about to be unlinked at a time.
const editing = ref<{ key: string, traktSeason: number | null, episodeOffset: number } | null>(null)
const unlinking = ref<string | null>(null)
const busy = ref(false)

async function post(url: string, body: object, done: string) {
  busy.value = true
  try {
    await $fetch(url, { method: 'POST', body })
    toast.add({ title: done, color: 'success', icon: 'i-lucide-circle-check' })
    editing.value = null
    unlinking.value = null
    emit('changed')
  } catch (err) {
    const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? String(err)
    toast.add({ title: 'Could not save', description: message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    busy.value = false
  }
}

function save(row: LinkRow) {
  const e = editing.value
  if (!e || e.traktSeason === null || row.seasonId === null) return
  post('/api/mappings/edit', { seasonId: row.seasonId, traktSeason: e.traktSeason, episodeOffset: e.episodeOffset }, 'Saved')
}

function unlink(row: LinkRow) {
  if (unlinking.value !== row.key) {
    unlinking.value = row.key
    return
  }
  post('/api/mappings/unlink', row.seasonId !== null ? { seasonId: row.seasonId } : { mappingId: row.mappingId }, 'Unlinked')
}

const restore = (row: LinkRow) => post('/api/mappings/unlink', { mappingId: row.mappingId, restore: true }, 'Linked again')
</script>

<template>
  <div class="space-y-3">
    <UTabs
      v-model="tab"
      :items="tabs"
      :content="false"
      size="sm"
    />

    <UTable
      :data="shown"
      :columns="columns"
      :empty="tab === 'anime' ? 'No anime linked yet.' : 'No shows linked yet.'"
      class="rounded-md border border-default"
    >
      <template #trakt-cell="{ row }">
        <SourceLinks
          v-if="row.original.trakt"
          :links="[{ label: row.original.trakt.title, url: row.original.trakt.url }]"
          class="font-medium"
        />
      </template>

      <template #season-cell="{ row }">
        <TraktSeasonSelect
          v-if="editing?.key === row.original.key && row.original.trakt"
          v-model="editing.traktSeason"
          :trakt-id="row.original.trakt.id"
        />
        <SourceLinks
          v-else-if="row.original.traktSeason !== null"
          :links="[{ label: `S${row.original.traktSeason}`, url: row.original.traktSeasonUrl }]"
        />
        <span
          v-else
          class="text-muted"
        >not placed</span>
      </template>

      <template #offset-cell="{ row }">
        <UInputNumber
          v-if="editing?.key === row.original.key"
          v-model="editing.episodeOffset"
          class="w-24"
        />
        <span v-else>{{ row.original.traktSeason !== null ? row.original.episodeOffset : '' }}</span>
      </template>

      <template #entry-cell="{ row }">
        <div>{{ row.original.entry.title }}</div>
        <div class="text-xs text-muted">
          <template v-if="row.original.entry.links.length">
            on <SourceLinks :links="row.original.entry.links" />
          </template>
        </div>
      </template>

      <template #how-cell="{ row }">
        <UBadge
          :label="row.original.status === 'confirmed' ? 'confirmed' : row.original.status === 'rejected' ? 'unlinked' : 'by ID'"
          :color="row.original.status === 'confirmed' ? 'success' : 'neutral'"
          variant="subtle"
        />
      </template>

      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-1">
          <template v-if="row.original.status === 'rejected'">
            <UButton
              label="Link again"
              size="xs"
              variant="soft"
              :loading="busy"
              @click="restore(row.original)"
            />
          </template>
          <template v-else-if="editing?.key === row.original.key">
            <UButton
              label="Save"
              size="xs"
              :disabled="editing.traktSeason === null"
              :loading="busy"
              @click="save(row.original)"
            />
            <UButton
              label="Cancel"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="editing = null"
            />
          </template>
          <template v-else>
            <UButton
              v-if="row.original.seasonId !== null"
              label="Edit"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="editing = { key: row.original.key, traktSeason: row.original.traktSeason, episodeOffset: row.original.episodeOffset }; unlinking = null"
            />
            <UButton
              :label="unlinking === row.original.key ? 'Confirm unlink' : 'Unlink'"
              size="xs"
              :color="unlinking === row.original.key ? 'error' : 'neutral'"
              :variant="unlinking === row.original.key ? 'solid' : 'ghost'"
              :loading="busy && unlinking === row.original.key"
              @click="unlink(row.original)"
            />
          </template>
        </div>
      </template>
    </UTable>
  </div>
</template>
