<script setup lang="ts">
import { groupLog, type LogEntry } from '#shared/utils/log-groups'

// Every write Tsuzuku sent to a source, newest first, with what the source said (step 6). Grouped by day
// and by mark: one card per show and episode with its poster (#88), a line per source (#74).
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

          <div class="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <UCard
              v-for="m in s.marks"
              :key="m.key"
              :ui="{ body: 'p-3 sm:p-3' }"
            >
              <div class="flex gap-3">
                <img
                  v-if="imageFor(m.images)"
                  :src="imageFor(m.images)!"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  class="h-24 w-16 shrink-0 rounded bg-elevated object-cover"
                  @error="failed.add(imageFor(m.images)!)"
                >
                <div
                  v-else
                  class="h-24 w-16 shrink-0 rounded bg-elevated"
                />
                <div class="min-w-0 flex-1 space-y-1.5">
                  <div class="flex items-start justify-between gap-2">
                    <span class="min-w-0 break-words font-medium leading-snug">{{ m.title }}</span>
                    <span class="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                      <UIcon
                        :name="m.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
                        :class="m.ok ? 'text-success' : 'text-error'"
                        class="size-4"
                      />
                      {{ clock(m.at) }}
                    </span>
                  </div>

                  <div
                    v-for="e in m.entries"
                    :key="e.id"
                    class="grid grid-cols-[4.5rem_1fr] gap-x-2 text-sm"
                  >
                    <ULink
                      v-if="e.url"
                      :to="e.url"
                      target="_blank"
                      external
                      :title="`${e.title} on ${SOURCE_LABELS[e.source] ?? e.source}`"
                      class="text-muted hover:text-highlighted"
                    >
                      <SourceName :source="e.source" />
                    </ULink>
                    <SourceName
                      v-else
                      :source="e.source"
                      class="text-muted"
                    />
                    <div class="min-w-0">
                      <SourceLinks
                        :links="[{ label: e.episode, url: e.episodeUrl ?? null }]"
                        class="font-semibold"
                      />
                      <span
                        v-if="e.title !== m.title"
                        class="text-muted"
                      > · <SourceLinks :links="[{ label: e.title, url: e.url ?? null }]" /></span>
                      <div class="text-muted">
                        {{ e.summary }}<template v-if="e.listStatus && e.listStatus !== 'watching'">
                          · now {{ LIST_STATUS_LABELS[e.listStatus] ?? e.listStatus }}
                        </template>
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
                  </div>
                </div>
              </div>
            </UCard>
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
