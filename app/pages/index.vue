<script setup lang="ts">
import { filterQuery, isFiltering, matchesFilter, parseFilter, type FilterChip, type UpNextFilter } from '#shared/utils/up-next-filter'

// Up Next (step 5): every show you are watching, one column per source, each with its own progress.
// Differences are flagged and left for you; no source is treated as correct (decisions #2, #10, #19).
useSeoMeta({ title: 'Up Next · Tsuzuku' })

const COLUMNS = ['trakt', 'simkl', 'mal'] as const

// Not awaited: switching to Up Next would otherwise wait for every source's live read. The last list stays
// on screen (kept for the session) while the new one loads; the first load in a tab waits on the server.
const { data: fresh, refresh, status } = useFetch('/api/up-next', { lazy: true })
const data = useState<typeof fresh.value>('up-next:last', () => undefined)
watch(fresh, (d) => {
  if (d) data.value = d
}, { immediate: true })
const { data: statuses, refresh: refreshStatuses } = useFetch('/api/sources/status', { lazy: true })
const loading = computed(() => status.value === 'pending')

async function reload() {
  await refresh()
  await refreshStatuses()
}

const allRows = computed(() => data.value?.rows ?? [])

// The filter bar (#68): over the rows already loaded, kept in the URL query.
const route = useRoute()
const router = useRouter()
const filter = ref<UpNextFilter>(parseFilter(route.query))
watch(filter, f => router.replace({ query: filterQuery(f) }), { deep: true })
watch(() => route.query, (q) => {
  const next = parseFilter(q)
  if (JSON.stringify(filterQuery(next)) !== JSON.stringify(filterQuery(filter.value))) filter.value = next
})
const filtering = computed(() => isFiltering(filter.value))
const toggleChip = (c: FilterChip) => {
  const only = filter.value.only
  filter.value.only = only.includes(c) ? only.filter(x => x !== c) : [...only, c]
}
function toggleKind(k: 'anime' | 'show') {
  filter.value.kind = filter.value.kind === k ? null : k
}
function clearFilter() {
  filter.value = { q: '', kind: null, only: [] }
}
const CHIPS: { chip: FilterChip, label: string }[] = [
  { chip: 'differs', label: 'Differs' },
  { chip: 'unmapped', label: 'Unmapped' },
  { chip: 'next', label: 'Has next episode' }
]

const rows = computed(() => allRows.value.filter(r => matchesFilter(r, filter.value)))
// What a section shows when the filter leaves it empty, so it never just disappears.
const emptyText = (all: number) => !data.value && loading.value ? 'Loading…' : filtering.value && all ? `No matches · ${all} hidden by the filter.` : undefined
const allOf = (section: 'trakt' | 'other', hasNext?: boolean) => allRows.value.filter(r => r.section === section && (hasNext === undefined || r.hasNext === hasNext)).length

const onTrakt = computed(() => rows.value.filter(r => r.section === 'trakt'))
const other = computed(() => rows.value.filter(r => r.section === 'other'))
const otherNext = computed(() => other.value.filter(r => r.hasNext))
const otherCaughtUp = computed(() => other.value.filter(r => !r.hasNext))
const differing = computed(() => allRows.value.filter(r => r.differs && !r.accepted).length)
const accepted = computed(() => allRows.value.filter(r => r.accepted).length)
const description = computed(() => {
  const head = differing.value ? `${differing.value} ${differing.value === 1 ? 'show differs' : 'shows differ'} between sources.` : 'All sources agree.'
  return accepted.value ? `${head} ${accepted.value} accepted ${accepted.value === 1 ? 'difference' : 'differences'}.` : head
})
// Your own open or close; until then (and again after a new search) a search opens the caught-up rows
// that match, so a match there is not tucked away.
const showCaughtUp = ref<boolean | null>(null)
const caughtUpOpen = computed(() => showCaughtUp.value ?? (!!filter.value.q.trim() && otherCaughtUp.value.length > 0))
watch(() => filter.value.q, () => {
  if (showCaughtUp.value === false) showCaughtUp.value = null
})

// "Mark watched": the row, and the source clicked when the sources do not all agree.
const markTarget = ref<{ rowKey: string, title: string, source?: 'trakt' | 'simkl' | 'mal' } | null>(null)
const markOpen = ref(false)
function mark(row: { key: string, title: string }, source?: 'trakt' | 'simkl' | 'mal') {
  markTarget.value = { rowKey: row.key, title: row.title, source }
  markOpen.value = true
}

// "Start next season" (#66): the row, and whether to begin with a search (nothing links it yet).
const startTarget = ref<{ rowKey: string, title: string, search: boolean, malId?: number } | null>(null)

// Coming back's lookup, shared with the cards: when a Trakt show is linked to nothing, its sequel there is
// offered on the card. Asked only when such a row exists, after the page is up.
const { data: comingBack, ensure: ensureComingBack } = useComingBack()
onMounted(() => watch(() => allRows.value.some(r => r.start?.search), (needed) => {
  if (needed) ensureComingBack()
}, { immediate: true }))
const startOpen = ref(false)
function start(row: { key: string, title: string }, search: boolean, malId?: number) {
  startTarget.value = { rowKey: row.key, title: row.title, search, malId }
  startOpen.value = true
}

// Saved on the server; update the row here instead of fetching every source again.
function setAccepted(key: string, value: boolean) {
  const row = data.value?.rows.find(r => r.key === key)
  if (row) row.accepted = value
}

const chips = computed(() => (statuses.value ?? []).filter(s => (COLUMNS as readonly string[]).includes(s.source)))
</script>

<template>
  <UContainer class="py-4 sm:py-8">
    <UPageHeader
      title="Up Next"
      :description="description"
    >
      <template #links>
        <div class="flex flex-wrap items-center gap-2">
          <span
            v-for="s in chips"
            :key="s.source"
            class="flex items-center gap-1 text-sm"
          >
            <SourceName :source="s.source" />
            <SourceStatusChip
              :status="s.status"
              :connected="s.connected"
              :needs-auth="true"
              :blocked-until="s.blockedUntil"
              :last-fetch-at="s.lastFetchAt"
              :last-error="s.lastError"
            />
          </span>
          <UButton
            label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="loading"
            @click="reload()"
          />
        </div>
      </template>
    </UPageHeader>

    <UPageBody>
      <UAlert
        v-if="data?.errors.length"
        color="warning"
        icon="i-lucide-circle-alert"
        title="Some list items could not be read"
        :description="data.errors.map(e => `${SOURCE_LABELS[e.source]}: ${e.error}`).join(' · ')"
      />

      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model="filter.q"
            icon="i-lucide-search"
            placeholder="Search titles"
            aria-label="Search titles on every source"
            class="w-full sm:w-72"
            :ui="{ trailing: 'pe-1' }"
          >
            <template
              v-if="filter.q"
              #trailing
            >
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="link"
                size="sm"
                aria-label="Clear search"
                @click="filter.q = ''"
              />
            </template>
          </UInput>
          <div class="flex flex-wrap items-center gap-1.5">
            <UButton
              v-for="c in CHIPS"
              :key="c.chip"
              :label="c.label"
              :color="filter.only.includes(c.chip) ? 'primary' : 'neutral'"
              :variant="filter.only.includes(c.chip) ? 'soft' : 'outline'"
              size="sm"
              :aria-pressed="filter.only.includes(c.chip)"
              @click="toggleChip(c.chip)"
            />
            <UFieldGroup size="sm">
              <UButton
                v-for="k in (['anime', 'show'] as const)"
                :key="k"
                :label="k === 'anime' ? 'Anime' : 'Shows'"
                :color="filter.kind === k ? 'primary' : 'neutral'"
                :variant="filter.kind === k ? 'soft' : 'outline'"
                :aria-pressed="filter.kind === k"
                @click="toggleKind(k)"
              />
            </UFieldGroup>
          </div>
        </div>
        <p
          v-if="filtering"
          class="flex flex-wrap items-center gap-x-2 text-sm text-muted"
        >
          <span>Showing {{ rows.length }} of {{ allRows.length }}</span>
          <UButton
            label="Clear filters"
            color="neutral"
            variant="link"
            size="sm"
            class="p-0"
            @click="clearFilter()"
          />
        </p>
      </div>

      <section
        v-for="group in [
          { title: 'Trakt up next', rows: onTrakt, hint: 'In Trakt\'s order.', all: allOf('trakt') },
          { title: 'Not in Trakt up next', rows: otherNext, hint: 'On Simkl or MAL with something to watch, by last activity.', all: allOf('other', true) }
        ]"
        :key="group.title"
        class="space-y-2"
      >
        <div class="flex items-baseline gap-2">
          <h2 class="text-lg font-semibold">
            {{ group.title }}
          </h2>
          <span class="text-sm text-muted">{{ group.hint }}</span>
        </div>
        <UpNextCards
          :rows="group.rows"
          :empty="emptyText(group.all)"
          :sequels="comingBack?.sequels"
          @accepted="setAccepted"
          @mark="mark"
          @start="start"
        />
      </section>

      <ComingBack />
      <section
        v-if="allOf('other', false)"
        class="space-y-2"
      >
        <UButton
          :label="`${caughtUpOpen ? 'Hide' : 'Show'} caught up (${filtering ? `${otherCaughtUp.length} of ${allOf('other', false)}` : otherCaughtUp.length})`"
          :icon="caughtUpOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          color="neutral"
          variant="ghost"
          size="xl"
          class="font-semibold"
          @click="showCaughtUp = !caughtUpOpen"
        />
        <UpNextCards
          v-if="caughtUpOpen"
          :rows="otherCaughtUp"
          :empty="emptyText(allOf('other', false))"
          :sequels="comingBack?.sequels"
          @accepted="setAccepted"
          @mark="mark"
          @start="start"
        />
      </section>
      <StartSeasonModal
        v-if="startTarget"
        :key="startTarget.rowKey"
        v-model:open="startOpen"
        :row-key="startTarget.rowKey"
        :title="startTarget.title"
        :search="startTarget.search"
        :mal-id="startTarget.malId"
        @started="refresh()"
      />
      <MarkWatchedModal
        v-if="markTarget"
        :key="`${markTarget.rowKey}:${markTarget.source ?? 'all'}`"
        v-model:open="markOpen"
        :row-key="markTarget.rowKey"
        :source="markTarget.source"
        :title="markTarget.title"
        @marked="refresh()"
      />
    </UPageBody>
  </UContainer>
</template>
