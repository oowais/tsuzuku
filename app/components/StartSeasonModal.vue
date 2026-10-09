<script setup lang="ts">
// "Start next season" (#66): finds the entry to start (the stored link, AniList's sequel, or one you pick from
// a search), previews what each source would do, then puts it on Watching with 0 episodes. Nothing is written
// before the confirm; the entry is then linked to Trakt's season.
type Source = 'simkl' | 'mal'
interface Target { malId: number, anilistId: number | null, title: string, format: string | null, episodes: number | null, status: string | null, year: number | null }
interface Plan {
  rowKey: string
  title: string
  traktNext: string
  target: Target | null
  choices: Target[]
  placement: { traktSeason: number, episodeOffset: number, linked: boolean } | null
  steps: { source: Source, summary: string, expected: string }[]
  skipped: { source: Source, reason: string }[]
  needsSearch: boolean
}
interface Outcome { source: Source, ok: boolean, error?: string }

const props = defineProps<{ rowKey: string, title: string, search?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ started: [] }>()

const plan = ref<Plan | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const picked = ref<Set<Source>>(new Set())
const outcomes = ref<Partial<Record<Source, Outcome>>>({})
const linkError = ref<string | null>(null)
const saving = ref(false)

// Search: for a show nothing links yet, or when AniList names no next season.
const searching = ref(false)
const query = ref(props.title)
const results = ref<Target[] | null>(null)
const searchLoading = ref(false)

const errorText = (e: unknown) => (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
const malUrl = (id: number) => `https://myanimelist.net/anime/${id}`
const describe = (t: Target) => [t.format, t.episodes ? `${t.episodes} eps` : null, t.year, t.status?.toLowerCase().replace(/_/g, ' ')].filter(Boolean).join(' · ')

async function preview(malId?: number) {
  loading.value = true
  loadError.value = null
  outcomes.value = {}
  linkError.value = null
  try {
    plan.value = await $fetch<Plan>('/api/next-season/preview', { method: 'POST', body: { rowKey: props.rowKey, malId } })
    picked.value = new Set(plan.value.steps.map(s => s.source))
    searching.value = !plan.value.target && plan.value.needsSearch
    if (searching.value) runSearch()
  } catch (e) {
    plan.value = null
    loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}

async function runSearch() {
  if (query.value.trim().length < 2) return
  searchLoading.value = true
  loadError.value = null
  try {
    results.value = await $fetch<Target[]>('/api/anilist/search', { query: { q: query.value.trim() } })
  } catch (e) {
    loadError.value = errorText(e)
  } finally {
    searchLoading.value = false
  }
}

function pick(t: Target) {
  searching.value = false
  preview(t.malId)
}

watch(open, (o) => {
  if (o) preview()
}, { immediate: true })

function toggle(source: Source, on: boolean | 'indeterminate') {
  const next = new Set(picked.value)
  if (on === true) next.add(source)
  else next.delete(source)
  picked.value = next
}

const pending = computed(() => (plan.value?.steps ?? []).filter(s => picked.value.has(s.source) && !outcomes.value[s.source]?.ok))
const anyFailed = computed(() => Object.values(outcomes.value).some(o => o && !o.ok))
const allDone = computed(() => !!plan.value && Object.keys(outcomes.value).length > 0 && !pending.value.length)

async function confirm() {
  if (!plan.value?.target || !pending.value.length) return
  saving.value = true
  try {
    const res = await $fetch<{ outcomes: Outcome[], linkError: string | null }>('/api/next-season/confirm', {
      method: 'POST',
      body: { rowKey: plan.value.rowKey, malId: plan.value.target.malId, steps: pending.value.map(s => ({ source: s.source, expected: s.expected })) }
    })
    outcomes.value = { ...outcomes.value, ...Object.fromEntries(res.outcomes.map(o => [o.source, o])) }
    linkError.value = res.linkError
    if (res.outcomes.some(o => o.ok)) emit('started')
    if (res.outcomes.every(o => o.ok) && !res.linkError) open.value = false
  } catch (e) {
    for (const s of pending.value) outcomes.value = { ...outcomes.value, [s.source]: { source: s.source, ok: false, error: errorText(e) } }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Start next season"
    :description="title"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="loadError"
          color="error"
          icon="i-lucide-circle-alert"
          :title="loadError"
        />

        <!-- Pick the entry: from a search, or among several sequels. -->
        <div
          v-if="searching"
          class="space-y-3"
        >
          <p
            v-if="!search"
            class="text-sm text-muted"
          >
            AniList names no next season for the linked entry. Search for it:
          </p>
          <p
            v-else
            class="text-sm text-muted"
          >
            Nothing links this show to an anime yet. Pick the entry that matches
            <SourceName source="trakt" /> {{ plan?.traktNext ?? 'next episode' }}:
          </p>
          <form
            class="flex gap-2"
            @submit.prevent="runSearch"
          >
            <UInput
              v-model="query"
              icon="i-lucide-search"
              class="flex-1"
              aria-label="Search AniList"
            />
            <UButton
              type="submit"
              label="Search"
              color="neutral"
              variant="outline"
              :loading="searchLoading"
            />
          </form>
          <ul
            v-if="results"
            class="max-h-80 overflow-y-auto rounded-md border border-default divide-y divide-default"
          >
            <li
              v-for="r in results"
              :key="r.malId"
              class="flex items-center gap-3 px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <ULink
                  :to="malUrl(r.malId)"
                  target="_blank"
                  external
                  class="font-medium underline decoration-dotted underline-offset-2"
                >
                  {{ r.title }}
                </ULink>
                <div class="text-xs text-muted">
                  {{ describe(r) }}
                </div>
              </div>
              <UButton
                label="Pick"
                size="xs"
                variant="soft"
                @click="pick(r)"
              />
            </li>
            <li
              v-if="!results.length"
              class="px-3 py-2 text-sm text-muted"
            >
              No anime found.
            </li>
          </ul>
        </div>

        <div
          v-else-if="loading"
          class="text-sm text-muted"
        >
          Loading…
        </div>

        <div
          v-else-if="plan && !plan.target && plan.choices.length"
          class="space-y-2"
        >
          <p class="text-sm text-muted">
            AniList names more than one next entry. Which one?
          </p>
          <ul class="rounded-md border border-default divide-y divide-default">
            <li
              v-for="c in plan.choices"
              :key="c.malId"
              class="flex items-center gap-3 px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <ULink
                  :to="malUrl(c.malId)"
                  target="_blank"
                  external
                  class="font-medium underline decoration-dotted underline-offset-2"
                >
                  {{ c.title }}
                </ULink>
                <div class="text-xs text-muted">
                  {{ describe(c) }}
                </div>
              </div>
              <UButton
                label="Pick"
                size="xs"
                variant="soft"
                @click="pick(c)"
              />
            </li>
          </ul>
        </div>

        <!-- The entry, where it goes, and each source's step. -->
        <div
          v-else-if="plan?.target"
          class="space-y-4"
        >
          <div>
            <ULink
              :to="malUrl(plan.target.malId)"
              target="_blank"
              external
              class="text-xl font-semibold text-highlighted leading-snug underline decoration-dotted underline-offset-4"
            >
              {{ plan.target.title }}
            </ULink>
            <div class="text-sm text-muted">
              {{ describe(plan.target) }}
            </div>
            <div
              v-if="plan.placement"
              class="mt-1 text-sm text-muted"
            >
              <template v-if="plan.placement.linked">
                Already linked to <SourceName source="trakt" /> S{{ plan.placement.traktSeason }}.
              </template>
              <template v-else>
                Will be linked to <SourceName source="trakt" /> S{{ plan.placement.traktSeason }}<template v-if="plan.placement.episodeOffset">
                  (offset {{ plan.placement.episodeOffset }})
                </template>; Trakt's next is {{ plan.traktNext }}.
              </template>
            </div>
            <UButton
              label="Not this one? Search"
              variant="link"
              size="xs"
              class="p-0"
              @click="searching = true; runSearch()"
            />
          </div>

          <ul class="rounded-md border border-default divide-y divide-default">
            <li
              v-for="s in plan.steps"
              :key="s.source"
              class="flex items-start gap-3 px-3 py-2.5"
            >
              <UCheckbox
                :model-value="picked.has(s.source)"
                :disabled="saving || !!outcomes[s.source]?.ok"
                class="mt-0.5"
                @update:model-value="toggle(s.source, $event)"
              />
              <div class="min-w-0 flex-1 text-sm">
                <SourceName
                  :source="s.source"
                  class="font-medium"
                />
                <div class="text-muted">
                  {{ s.summary }}
                </div>
                <div
                  v-if="outcomes[s.source] && !outcomes[s.source]!.ok"
                  class="text-error"
                >
                  {{ outcomes[s.source]!.error }}
                </div>
              </div>
              <span
                v-if="outcomes[s.source]?.ok"
                class="flex items-center gap-1 text-sm text-success shrink-0"
              >
                <UIcon
                  name="i-lucide-check"
                  class="size-4"
                />
                done
              </span>
            </li>
            <li
              v-for="s in plan.skipped"
              :key="s.source"
              class="px-3 py-2 text-sm text-muted"
            >
              <SourceName :source="s.source" />: {{ s.reason }}
            </li>
            <li
              v-if="!plan.steps.length"
              class="px-3 py-2 text-sm text-muted"
            >
              Nothing to start right now.
            </li>
          </ul>
          <UAlert
            v-if="linkError"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="`Started, but not linked: ${linkError}`"
            description="Link it on Mappings once it shows on your list."
          />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2">
        <UButton
          v-if="plan?.target && !searching && !allDone"
          :label="anyFailed ? 'Retry' : `Start on ${pending.length} ${pending.length === 1 ? 'source' : 'sources'}`"
          :icon="anyFailed ? 'i-lucide-refresh-cw' : 'i-lucide-play'"
          :disabled="loading || !pending.length"
          :loading="saving"
          @click="confirm"
        />
        <UButton
          :label="allDone ? 'Close' : 'Cancel'"
          color="neutral"
          variant="outline"
          @click="open = false"
        />
      </div>
    </template>
  </UModal>
</template>
