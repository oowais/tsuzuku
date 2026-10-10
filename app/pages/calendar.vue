<script setup lang="ts">
// What airs this month and next (#72), per source and never merged: Trakt's calendar of your shows, AniList
// for the anime on Up Next, Simkl's date for your next episode. When two sources date the same episode
// differently, both show (decision #19). Read-only: every item links to its source's page (decision #24).
// Month grid on wide screens, an agenda of the days with episodes on narrow ones. Local time throughout.
useSeoMeta({ title: 'Calendar · Tsuzuku' })

interface Item {
  source: 'trakt' | 'anilist' | 'simkl'
  group: string
  title: string
  episode: string
  episodeTitle: string | null
  airsAt: string
  dateOnly: boolean
  url: string | null
  watched: boolean
  onUpNext: boolean
}
interface SourceState { status: string, stale: boolean, error: string | null, retryAfter: number | null }

// Last month, this month and next.
const MIN_OFFSET = -1
const MAX_OFFSET = 1
const offset = ref(0)
const today = new Date()
const monthStart = computed(() => new Date(today.getFullYear(), today.getMonth() + offset.value, 1))
const monthEnd = computed(() => new Date(today.getFullYear(), today.getMonth() + offset.value + 1, 1))
const monthLabel = computed(() => monthStart.value.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))

// The browser's time zone decides the month, so this is fetched client-side only.
const { data, status, error, refresh } = useFetch<{ items: Item[], sources: Record<'trakt' | 'anilist', SourceState> }>('/api/calendar', {
  query: computed(() => ({ from: monthStart.value.toISOString(), to: monthEnd.value.toISOString() })),
  server: false
})

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// A date-only item (Simkl) sits on the date it was written with; the rest on their local day.
const itemDay = (i: Item) => (i.dateOnly ? i.airsAt.slice(0, 10) : dayKey(new Date(i.airsAt)))
const time = (i: Item) => (i.dateOnly ? null : new Date(i.airsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))

// Per day, one show's items next to each other, earliest show first.
const byDay = computed(() => {
  const days = new Map<string, Item[][]>()
  for (const item of data.value?.items ?? []) {
    const groups = days.get(itemDay(item)) ?? []
    const group = groups.find(g => g[0]!.group === item.group)
    if (group) group.push(item)
    else groups.push([item])
    days.set(itemDay(item), groups)
  }
  return days
})

const todayKey = dayKey(today)
// The grid: Monday-first weeks covering the month.
const cells = computed(() => {
  const first = monthStart.value
  const lead = (first.getDay() + 6) % 7
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const out: ({ key: string, day: number } | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= count; d++) out.push({ key: dayKey(new Date(first.getFullYear(), first.getMonth(), d)), day: d })
  while (out.length % 7) out.push(null)
  return out
})
const monthDays = computed(() => [...byDay.value.entries()]
  .filter(([key]) => key.startsWith(dayKey(monthStart.value).slice(0, 7)))
  .sort(([a], [b]) => a.localeCompare(b)))
// This month's agenda starts today; the days before are one tap away.
const showEarlier = ref(false)
watch(offset, () => (showEarlier.value = false))
const earlier = computed(() => (offset.value === 0 ? monthDays.value.filter(([key]) => key < todayKey).length : 0))
const agenda = computed(() => (showEarlier.value ? monthDays.value : monthDays.value.slice(earlier.value)))
const agendaLabel = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

const warnings = computed(() => Object.entries(data.value?.sources ?? {})
  .filter(([, s]) => s.status !== 'ok')
  .map(([source, s]) => ({ source, text: s.status === 'rate_limited' ? `rate limited${s.retryAfter ? `, try again in ${s.retryAfter} s` : ''}` : s.error ?? s.status, stale: s.stale })))

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const label = (i: Item) => `${i.title} ${i.episode}${i.episodeTitle ? ` “${i.episodeTitle}”` : ''} on ${SOURCE_LABELS[i.source]}${time(i) ? ` at ${time(i)}` : ''}${i.dateOnly ? ' (date as Simkl gives it)' : ''}${i.watched ? ', watched' : ''}`
</script>

<template>
  <UContainer class="py-4 sm:py-8">
    <UPageHeader
      title="Calendar"
      description="What airs, as each source dates it. When sources disagree, both show."
    >
      <template #links>
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="ghost"
            aria-label="Previous month"
            :disabled="offset <= MIN_OFFSET"
            @click="offset--"
          />
          <span class="min-w-32 text-center font-medium tabular-nums">{{ monthLabel }}</span>
          <UButton
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="ghost"
            aria-label="Next month"
            :disabled="offset >= MAX_OFFSET"
            @click="offset++"
          />
          <UButton
            v-if="offset !== 0"
            label="Today"
            color="neutral"
            variant="outline"
            size="sm"
            @click="offset = 0"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            aria-label="Refresh"
            :loading="status === 'pending'"
            @click="refresh()"
          />
        </div>
      </template>
    </UPageHeader>

    <UPageBody>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="`Could not load the calendar: ${error.statusMessage ?? error.message}`"
      />
      <UAlert
        v-for="w in warnings"
        :key="w.source"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
      >
        <template #title>
          <SourceName :source="w.source" /> {{ w.text }}{{ w.stale ? ' · showing what it said last' : '' }}
        </template>
      </UAlert>

      <ClientOnly>
        <!-- Wide: the month as a grid. -->
        <div class="hidden lg:block">
          <div class="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-default bg-(--ui-border)">
            <div
              v-for="d in WEEKDAYS"
              :key="d"
              class="bg-elevated/50 px-2 py-1 text-xs font-medium text-muted"
            >
              {{ d }}
            </div>
            <div
              v-for="(c, i) in cells"
              :key="c?.key ?? `pad-${i}`"
              class="min-h-28 bg-default p-1.5"
              :class="!c && 'bg-elevated/30'"
            >
              <template v-if="c">
                <div
                  class="mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular-nums"
                  :class="c.key === todayKey ? 'bg-primary font-semibold text-inverted' : c.key < todayKey ? 'text-dimmed' : 'text-muted'"
                >
                  {{ c.day }}
                </div>
                <div class="space-y-1">
                  <div
                    v-for="g in byDay.get(c.key) ?? []"
                    :key="g[0]!.group"
                    class="space-y-0.5 rounded px-1 py-0.5"
                    :class="g.length > 1 && 'bg-elevated/60'"
                  >
                    <component
                      :is="item.url ? 'a' : 'div'"
                      v-for="item in g"
                      :key="item.source"
                      :href="item.url ?? undefined"
                      target="_blank"
                      rel="noopener"
                      :title="label(item)"
                      class="flex items-baseline gap-1 text-xs leading-snug hover:text-highlighted"
                      :class="item.watched ? 'opacity-50' : ''"
                    >
                      <SourceIcon :source="item.source" />
                      <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
                      <span class="shrink-0 font-medium tabular-nums">{{ item.episode }}</span>
                    </component>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Narrow: the days that have episodes. -->
        <div class="space-y-4 lg:hidden">
          <p
            v-if="status !== 'pending' && !agenda.length"
            class="text-sm text-muted"
          >
            Nothing airs this month{{ earlier ? ' from today' : '' }}.
          </p>
          <UButton
            v-if="earlier && !showEarlier"
            :label="`Show ${earlier} earlier ${earlier === 1 ? 'day' : 'days'}`"
            icon="i-lucide-chevrons-up"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="showEarlier = true"
          />
          <section
            v-for="[key, groups] in agenda"
            :key="key"
            class="space-y-2"
          >
            <h2
              class="flex items-baseline gap-2 font-semibold"
              :class="key < todayKey && 'text-muted'"
            >
              {{ agendaLabel(key) }}
              <UBadge
                v-if="key === todayKey"
                label="Today"
                size="sm"
                variant="subtle"
              />
            </h2>
            <ul class="divide-y divide-default rounded-md border border-default">
              <li
                v-for="g in groups"
                :key="g[0]!.group"
                class="space-y-1 px-3 py-2"
              >
                <component
                  :is="item.url ? 'a' : 'div'"
                  v-for="item in g"
                  :key="item.source"
                  :href="item.url ?? undefined"
                  target="_blank"
                  rel="noopener"
                  :aria-label="label(item)"
                  class="flex items-baseline gap-2 text-sm"
                  :class="item.watched ? 'opacity-50' : ''"
                >
                  <SourceIcon :source="item.source" />
                  <span class="min-w-0 flex-1">
                    <span class="font-medium">{{ item.title }}</span>
                    <span class="text-muted"> · {{ item.episode }}<template v-if="item.episodeTitle"> “{{ item.episodeTitle }}”</template></span>
                  </span>
                  <span class="shrink-0 text-xs text-muted tabular-nums">{{ time(item) ?? 'date only' }}</span>
                </component>
              </li>
            </ul>
          </section>
        </div>

        <p class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span class="flex items-center gap-1"><SourceIcon source="trakt" /> Trakt: your shows' calendar</span>
          <span class="flex items-center gap-1"><SourceIcon source="anilist" /> AniList: the anime on Up Next</span>
          <span class="flex items-center gap-1"><SourceIcon source="simkl" /> Simkl: your next episode, the date as Simkl gives it</span>
          <span><span class="opacity-50">Faded</span>: watched</span>
          <span class="flex items-center gap-1"><span class="inline-block h-3 w-5 rounded-sm bg-elevated/60 ring-1 ring-default" /> Shaded: one show from several sources</span>
        </p>

        <template #fallback>
          <p class="text-sm text-muted">
            Loading…
          </p>
        </template>
      </ClientOnly>
    </UPageBody>
  </UContainer>
</template>
