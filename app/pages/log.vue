<script setup lang="ts">
import { groupLog, type LogEntry } from '#shared/utils/log-groups'

// Every write Tsuzuku sent to a source, newest first, with what the source said (step 6). Grouped by day
// and by mark: one card per show and episode with its poster (#88), a line per source (#74). A failed write
// marks the card's edge red, like a difference on Up Next.
useSeoMeta({ title: 'Write log · Tsuzuku' })

const { data, refresh, status } = await useFetch('/api/write-log')
const sessions = computed(() => groupLog((data.value ?? []) as LogEntry[]))

// In the browser's own time zone, so rendered client-side only.
const DAY = 24 * 60 * 60 * 1000
function dayLabel(at: Date) {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(new Date()) - start(at)) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(at.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}
// The first poster that loads; a broken URL falls through to the next, then to a blank tile.
const failed = reactive(new Set<string>())
const imageFor = (images: string[]) => images.find(u => !failed.has(u)) ?? null
const clock = (at: Date) => at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
// "Today · 15:40–20:05", one time when the day has a single write.
function sessionLabel(s: { start: Date, end: Date }) {
  const [day, from, to] = [dayLabel(s.end), clock(s.start), clock(s.end)]
  return from === to ? `${day} · ${to}` : `${day} · ${from}–${to}`
}
// The episode every source of a mark shares, shown once as a chip; null when they number it differently.
function sharedEpisode(m: { entries: LogEntry[] }) {
  const eps = new Set(m.entries.map(e => e.episode))
  return eps.size === 1 ? m.entries[0]!.episode : null
}
// The episode is on the card already, so "Add S2E5 to history, watched now, rated 8" reads "Added to history,
// rated 8". Other summaries (MAL's count, a season start) are shown as logged.
const shortSummary = (e: LogEntry) => e.summary.replace(/^Add \S+ to history, watched now/, 'Added to history')
</script>

<template>
  <UContainer class="py-4 sm:py-8">
    <UPageHeader
      title="Write log"
      description="Every change sent to Trakt, Simkl or MAL, and whether the source took it."
    >
      <template #links>
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="refresh()"
        />
      </template>
    </UPageHeader>

    <UPageBody>
      <ClientOnly>
        <p
          v-if="!sessions.length"
          class="text-sm text-muted"
        >
          Nothing written yet.
        </p>

        <section
          v-for="s in sessions"
          :key="s.end.getTime()"
          class="space-y-2"
        >
          <h2 class="flex flex-wrap items-baseline gap-x-2">
            <span class="font-semibold">{{ sessionLabel(s) }}</span>
            <span class="text-sm text-muted">{{ s.shows }} {{ s.shows === 1 ? 'show' : 'shows' }}</span>
          </h2>

          <div class="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            <article
              v-for="m in s.marks"
              :key="m.key"
              class="flex gap-3 sm:gap-4 rounded-lg border border-default border-s-4 p-3 sm:p-4"
              :class="m.ok ? 'border-s-default' : 'border-s-error'"
            >
              <img
                v-if="imageFor(m.images)"
                :src="imageFor(m.images)!"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                class="h-30 w-20 sm:h-36 sm:w-24 shrink-0 rounded bg-elevated object-cover"
                @error="failed.add(imageFor(m.images)!)"
              >
              <div
                v-else
                class="h-30 w-20 sm:h-36 sm:w-24 shrink-0 rounded bg-elevated"
              />

              <div class="min-w-0 flex-1 space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <h3 class="min-w-0 text-base font-semibold leading-tight line-clamp-2 break-words">
                    {{ m.title }}
                  </h3>
                  <span class="shrink-0 text-sm text-muted tabular-nums">{{ clock(m.at) }}</span>
                </div>

                <div
                  v-if="sharedEpisode(m) || !m.ok"
                  class="flex flex-wrap items-center gap-1.5"
                >
                  <UBadge
                    v-if="sharedEpisode(m)"
                    :label="sharedEpisode(m)!"
                    color="primary"
                    variant="soft"
                    class="font-semibold tabular-nums"
                  />
                  <UBadge
                    v-if="!m.ok"
                    :label="m.entries.every(e => e.result === 'error') ? 'failed' : 'partly failed'"
                    icon="i-lucide-circle-alert"
                    color="error"
                    variant="subtle"
                  />
                </div>

                <ul class="space-y-1.5 text-sm">
                  <li
                    v-for="e in m.entries"
                    :key="e.id"
                    class="flex items-start gap-2"
                  >
                    <ULink
                      v-if="e.episodeUrl || e.url"
                      :to="(e.episodeUrl ?? e.url)!"
                      target="_blank"
                      external
                      :title="`${e.title} on ${SOURCE_LABELS[e.source] ?? e.source}`"
                      class="mt-0.5 shrink-0 hover:opacity-80"
                    >
                      <SourceIcon :source="e.source" />
                    </ULink>
                    <SourceIcon
                      v-else
                      :source="e.source"
                      class="mt-0.5 shrink-0"
                    />
                    <div class="min-w-0 flex-1">
                      <div
                        v-if="!sharedEpisode(m) || e.title !== m.title"
                        class="line-clamp-1"
                        :title="e.title"
                      >
                        <span
                          v-if="!sharedEpisode(m)"
                          class="font-semibold"
                        >{{ e.episode }}</span>
                        <span
                          v-if="e.title !== m.title"
                          class="text-muted"
                        ><template v-if="!sharedEpisode(m)"> · </template>{{ e.title }}</span>
                      </div>
                      <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span :class="e.result === 'error' ? 'text-muted line-through decoration-error/60' : 'text-default'">{{ shortSummary(e) }}</span>
                        <UBadge
                          v-if="e.listStatus && e.listStatus !== 'watching'"
                          :label="LIST_STATUS_LABELS[e.listStatus] ?? e.listStatus"
                          color="neutral"
                          variant="outline"
                          size="sm"
                        />
                      </div>
                      <div
                        v-if="e.result === 'error'"
                        class="flex items-start gap-1 text-error"
                      >
                        <UIcon
                          name="i-lucide-x"
                          class="mt-0.5 size-4 shrink-0"
                        />
                        <span class="break-words">{{ e.error ?? 'failed' }}</span>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </article>
          </div>
        </section>

        <template #fallback>
          <p class="text-sm text-muted">
            Loading…
          </p>
        </template>
      </ClientOnly>
    </UPageBody>
  </UContainer>
</template>
