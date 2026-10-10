<script setup lang="ts">
// "Coming back" (#66): sequels of anime you completed that are on no watching list. Collapsed; the sources are
// asked when it is opened, or when an Up Next card needs a sequel to offer (useComingBack; cached on the
// server: MAL for a day, AniList by how far the sequel is).
type Sequel = ComingBackSequel

const startTarget = ref<{ malId: number, title: string } | null>(null)
const startOpen = ref(false)
function start(s: Sequel) {
  startTarget.value = { malId: s.malId, title: s.title }
  startOpen.value = true
}

const open = ref(false)
const { data, loading, error: loadError, load, ensure } = useComingBack()
const showDismissed = ref(false)
// Covers that failed to load fall back to the empty frame.
const failedCovers = reactive(new Set<string>())

const errorText = (e: unknown) => (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message

function toggle() {
  open.value = !open.value
  if (open.value) ensure()
}

async function setDismissed(s: Sequel, dismissed: boolean) {
  s.dismissed = dismissed
  try {
    await $fetch(`/api/coming-back/${dismissed ? 'dismiss' : 'undo-dismiss'}`, { method: 'POST', body: { malId: s.malId } })
  } catch (e) {
    s.dismissed = !dismissed
    loadError.value = errorText(e)
  }
}

const shown = computed(() => (data.value?.sequels ?? []).filter(s => !s.dismissed))
const dismissed = computed(() => (data.value?.sequels ?? []).filter(s => s.dismissed))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// An announcement can be just a year, or a month: show what AniList knows and no more.
function partialDate(d: Sequel['startDate']): string {
  if (!d.year) return 'date not announced'
  if (!d.month) return String(d.year)
  return `${d.day ? `${d.day} ` : ''}${MONTHS[d.month - 1]} ${d.year}`
}

function stageText(s: Sequel): string {
  const at = s.nextEpisode ? new Date(s.nextEpisode.airingAt * 1000).toISOString() : null
  switch (s.stage) {
    case 'airing':
      return s.nextEpisode && s.nextEpisode.episode > 1 ? `E${s.nextEpisode.episode - 1} out` : 'Airing'
    case 'scheduled':
      return at ? `Starts ${shortDate(at)} (${relativeTime(at)})` : 'Scheduled'
    case 'announced':
      return `Announced · ${partialDate(s.startDate)}`
    default:
      return 'Already out'
  }
}

const count = computed(() => (data.value ? ` (${shown.value.length})` : ''))
</script>

<template>
  <section class="space-y-2">
    <UButton
      :label="`${open ? 'Hide' : 'Show'} coming back${count}`"
      :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
      color="neutral"
      variant="ghost"
      @click="toggle"
    />
    <div
      v-if="open"
      class="space-y-3"
    >
      <p class="text-sm text-muted">
        Sequels of anime you completed that are on no watching list yet.
      </p>
      <div
        v-if="loading"
        class="text-sm text-muted"
      >
        Looking up your completed anime…
      </div>
      <UAlert
        v-else-if="loadError"
        color="error"
        icon="i-lucide-circle-alert"
        :title="loadError"
      />
      <template v-else-if="data">
        <p
          v-if="data.mal.stale || data.mal.status !== 'ok'"
          class="flex items-start gap-1.5 text-sm text-warning"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="mt-0.5 size-4 shrink-0"
          />
          <span><SourceName source="mal" /> could not be read just now{{ data.mal.error ? ` (${data.mal.error})` : '' }}; showing its list from {{ data.mal.fetchedAt ? relativeTime(data.mal.fetchedAt) : 'before' }}.</span>
        </p>
        <p
          v-if="data.anilist.missing || data.anilist.status !== 'ok'"
          class="flex items-start gap-1.5 text-sm text-warning"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="mt-0.5 size-4 shrink-0"
          />
          <span><SourceName source="anilist" /> did not answer for {{ data.anilist.missing }} {{ data.anilist.missing === 1 ? 'entry' : 'entries' }}{{ data.anilist.error ? ` (${data.anilist.error})` : '' }}; they are skipped for now.</span>
        </p>

        <p
          v-if="!shown.length"
          class="text-sm text-muted"
        >
          Nothing coming back right now.
        </p>
        <ul
          v-else
          class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <li
            v-for="s in shown"
            :key="s.malId"
            class="flex gap-3 rounded-md border border-default bg-elevated/25 p-2.5"
          >
            <img
              v-if="s.cover && !failedCovers.has(s.cover)"
              :src="s.cover"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              class="h-24 w-16 shrink-0 rounded object-cover bg-elevated"
              @error="failedCovers.add(s.cover)"
            >
            <div
              v-else
              class="h-24 w-16 shrink-0 rounded bg-elevated"
            />
            <div class="flex min-w-0 flex-1 flex-col">
              <div class="flex items-start gap-1">
                <a
                  :href="`https://myanimelist.net/anime/${s.malId}`"
                  target="_blank"
                  rel="noopener"
                  :title="s.title"
                  class="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug hover:underline"
                >{{ s.title }}</a>
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="-me-1 -mt-1 shrink-0"
                  title="Dismiss"
                  aria-label="Dismiss"
                  @click="setDismissed(s, true)"
                />
              </div>
              <p class="text-xs text-muted">
                {{ stageText(s) }}
              </p>
              <p
                class="truncate text-xs text-dimmed"
                :title="`after ${s.from.title}`"
              >
                after {{ s.from.title }}
              </p>
              <div class="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1.5 text-xs text-dimmed">
                <a
                  :href="`https://myanimelist.net/anime/${s.malId}`"
                  target="_blank"
                  rel="noopener"
                  class="hover:underline"
                ><SourceName source="mal" /></a>
                <a
                  :href="`https://anilist.co/anime/${s.anilistId}`"
                  target="_blank"
                  rel="noopener"
                  class="hover:underline"
                ><SourceName source="anilist" /></a>
                <UBadge
                  v-if="s.onPlanToWatch"
                  label="Plan to Watch"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
                <UButton
                  v-if="s.stage === 'airing' || s.stage === 'released'"
                  label="Start"
                  icon="i-lucide-play"
                  size="xs"
                  variant="soft"
                  class="ms-auto"
                  @click="start(s)"
                />
              </div>
            </div>
          </li>
        </ul>

        <div v-if="dismissed.length">
          <UButton
            :label="`${showDismissed ? 'Hide' : 'Show'} dismissed (${dismissed.length})`"
            color="neutral"
            variant="link"
            size="sm"
            class="p-0"
            @click="showDismissed = !showDismissed"
          />
          <ul
            v-if="showDismissed"
            class="mt-2 rounded-md border border-default divide-y divide-default"
          >
            <li
              v-for="s in dismissed"
              :key="s.malId"
              class="flex items-center gap-3 px-3 py-2 text-sm text-muted"
            >
              <span class="min-w-0 flex-1">{{ s.title }} · {{ stageText(s) }}</span>
              <UButton
                label="Undo"
                color="neutral"
                variant="link"
                size="sm"
                class="p-0"
                @click="setDismissed(s, false)"
              />
            </li>
          </ul>
        </div>
      </template>
    </div>
    <StartSeasonModal
      v-if="startTarget"
      :key="startTarget.malId"
      v-model:open="startOpen"
      :row-key="`coming:${startTarget.malId}`"
      :title="startTarget.title"
      @started="load()"
    />
  </section>
</template>
