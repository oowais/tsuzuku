<script setup lang="ts">
import { itemUrl } from '#shared/utils/source-links'

// Search Trakt (or paste a trakt.tv link), pick the show, pick the season, confirm.
// Only shows Trakt returns can be picked; the server checks the ID with Trakt again on confirm.
// The entry being linked is shown with each source's title, links and progress, and where it sits in the
// series on AniList, so the right Trakt season can be chosen.
interface ChainItem { malId: number, title: string, format: string | null, episodes: number | null, year: number | null }
const props = defineProps<{
  animeKey: string
  entries: (EntryLike & { format: string | null, episodes: number | null })[]
  chain: ChainItem[]
  defaultQuery: string
}>()
const animeTitle = computed(() => entryTitles(props.entries))
const episodes = computed(() => props.entries.find(e => e.source === 'mal')?.episodes ?? props.entries[0]?.episodes ?? null)
const format = computed(() => props.entries.find(e => e.format)?.format ?? null)
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ linked: [] }>()
const toast = useToast()

const query = ref(props.defaultQuery)
const results = ref<Awaited<ReturnType<typeof searchTrakt>> | null>(null)
const searching = ref(false)

const searchTrakt = (q: string) => $fetch('/api/trakt/search', { query: { q } })

async function search(q: string) {
  if (!q.trim()) {
    results.value = null
    return
  }
  searching.value = true
  try {
    results.value = await searchTrakt(q)
  } finally {
    searching.value = false
  }
}

// Search once typing pauses, not on every key.
let timer: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
  clearTimeout(timer)
  timer = setTimeout(() => search(q), 400)
})
onBeforeUnmount(() => clearTimeout(timer))

type Show = NonNullable<typeof results.value>['data'][number]
const picked = ref<Show | null>(null)
const season = ref<number | null>(null)
const offset = ref(0)
const saving = ref(false)

watch(open, (o) => {
  if (!o) return
  query.value = props.defaultQuery
  picked.value = null
  season.value = null
  offset.value = 0
  search(props.defaultQuery)
}, { immediate: true })

async function confirm() {
  if (!picked.value || season.value === null) return
  saving.value = true
  try {
    await $fetch('/api/mappings/confirm', {
      method: 'POST',
      body: { traktId: picked.value.trakt, animeKey: props.animeKey, traktSeason: season.value, episodeOffset: offset.value }
    })
    toast.add({ title: 'Linked', color: 'success', icon: 'i-lucide-circle-check' })
    open.value = false
    emit('linked')
  } catch (err) {
    const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? String(err)
    toast.add({ title: 'Could not link', description: message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Link to Trakt"
    description="Find the Trakt show this entry belongs to, then the season."
  >
    <template #body>
      <div class="mb-4 rounded-md border border-default p-3 space-y-1">
        <div class="text-xs text-muted">
          Linking, on <SourceLinks :links="entrySourceLinks(entries)" />
        </div>
        <div class="font-medium">
          {{ animeTitle }}
        </div>
        <div class="text-sm text-muted">
          {{ [format, episodes !== null ? `${episodes} episodes` : null].filter(Boolean).join(' · ') }}
          <span
            v-for="(g, i) in entryNextGroups(entries)"
            :key="g.label"
          >{{ i || format || episodes !== null ? ' · ' : '' }}next {{ g.label }} on <SourceLinks :links="g.links" /></span>
        </div>
        <div
          v-if="chain.length > 1"
          class="text-sm text-muted"
        >
          Season {{ chain.length }} on AniList:
          <template
            v-for="(c, i) in chain"
            :key="c.malId"
          >
            <span v-if="i"> → </span>
            <SourceLinks :links="[{ label: c.title, url: itemUrl({ source: 'mal', kind: 'anime', ids: { mal: c.malId } }) }]" />
            <span v-if="c.episodes !== null"> ({{ c.episodes }})</span>
          </template>
        </div>
      </div>

      <div
        v-if="!picked"
        class="space-y-3"
      >
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Title or https://trakt.tv/shows/…"
          :loading="searching"
          class="w-full"
          autofocus
        />
        <p
          v-if="results && results.status !== 'ok'"
          class="text-sm text-error"
        >
          Trakt is not answering ({{ results.status }}). Try again shortly.
        </p>
        <ul class="divide-y divide-default">
          <li
            v-for="s in results?.data ?? []"
            :key="s.trakt"
            class="flex items-center gap-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <SourceLinks :links="[{ label: s.title, url: itemUrl({ source: 'trakt', kind: 'show', ids: { traktSlug: s.slug } }) }]" />
              <div class="text-xs text-muted">
                {{ [s.year, s.originalTitle, s.airedEpisodes !== null ? `${s.airedEpisodes} episodes` : null].filter(Boolean).join(' · ') }}
              </div>
            </div>
            <UButton
              label="Pick"
              size="sm"
              @click="picked = s"
            />
          </li>
          <li
            v-if="results && !results.data.length && !searching"
            class="py-2 text-sm text-muted"
          >
            No shows found.
          </li>
        </ul>
      </div>

      <div
        v-else-if="picked"
        class="space-y-3"
      >
        <div>
          <SourceLinks :links="[{ label: picked.title, url: itemUrl({ source: 'trakt', kind: 'show', ids: { traktSlug: picked.slug } }) }]" />
          <span class="text-sm text-muted"> {{ picked.year }}</span>
          <UButton
            label="Change"
            size="xs"
            variant="link"
            @click="picked = null"
          />
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField label="Trakt season">
            <TraktSeasonSelect
              v-model="season"
              :trakt-id="picked.trakt"
            />
          </UFormField>
          <UFormField
            label="Episode offset"
            help="Trakt episode minus this entry's episode"
          >
            <UInputNumber
              v-model="offset"
              class="w-28"
            />
          </UFormField>
        </div>
        <p
          v-if="season !== null"
          class="text-sm"
        >
          {{ animeTitle }} E1 = Trakt S{{ season }}E{{ 1 + offset }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2">
        <UButton
          label="Confirm"
          icon="i-lucide-check"
          :disabled="!picked || season === null"
          :loading="saving"
          @click="confirm"
        />
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="open = false"
        />
      </div>
    </template>
  </UModal>
</template>
