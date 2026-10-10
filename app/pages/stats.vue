<script setup lang="ts">
// Stats (#53): each source's own numbers side by side, never added up, and Tsuzuku's marks from the write
// log. Source stats are kept on the server for 12 hours; Refresh asks the sources again.
useSeoMeta({ title: 'Stats · Tsuzuku' })

const refreshing = ref(false)
const { data, status } = await useFetch('/api/stats')

async function reload() {
  refreshing.value = true
  try {
    data.value = await $fetch<NonNullable<typeof data.value>>('/api/stats', { query: { refresh: '1' } })
  } finally {
    refreshing.value = false
  }
}

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
function show(f: { value: number, unit?: string }) {
  if (f.unit === 'minutes') {
    const hours = f.value / 60
    return hours >= 48 ? `${nf.format(hours / 24)} days` : `${nf.format(hours)} h`
  }
  if (f.unit === 'days') return `${nf.format(f.value)} days`
  if (f.unit === 'score') return f.value.toFixed(2)
  return nf.format(f.value)
}

function historyCells(h: { total: number | null, first: string | null, recent: string[] }) {
  const f = historyFigures(h)
  return [
    { label: 'This week', value: nf.format(f.week) },
    { label: 'This month', value: nf.format(f.month) },
    ...(f.weeklyAverage === null ? [] : [{ label: 'Weekly average', value: nf.format(f.weeklyAverage) }]),
    ...(h.first ? [{ label: 'Since', value: shortDate(h.first) ?? '' }] : [])
  ]
}
</script>

<template>
  <UContainer class="py-4 sm:py-8">
    <UPageHeader
      title="Stats"
      description="Each source's own numbers. They count differently, so they are never added up."
    >
      <template #links>
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="refreshing || status === 'pending'"
          @click="reload()"
        />
      </template>
    </UPageHeader>

    <UPageBody>
      <div class="grid items-start gap-4 lg:grid-cols-3">
        <UCard
          v-for="s in data?.sources ?? []"
          :key="s.source"
          :ui="{ body: 'space-y-4' }"
        >
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <SourceName
                :source="s.source"
                class="text-lg font-semibold"
              />
              <span class="flex items-center gap-1.5 text-xs text-muted">
                <UBadge
                  v-if="s.stale"
                  label="stale"
                  color="neutral"
                  variant="outline"
                  size="sm"
                />
                <template v-if="s.fetchedAt">updated {{ relativeTime(String(s.fetchedAt)) }}</template>
              </span>
            </div>
          </template>

          <p
            v-if="s.note"
            class="text-xs text-muted"
          >
            {{ s.note }}
          </p>

          <UAlert
            v-if="s.error"
            :color="s.headline.length ? 'neutral' : 'warning'"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="s.headline.length ? `Showing earlier numbers: ${s.error}` : s.error"
          />
          <p
            v-else-if="!s.headline.length && !s.breakdowns.length"
            class="text-sm text-muted"
          >
            No figures in the answer.
          </p>

          <!-- The numbers the card leads with. -->
          <dl
            v-if="s.headline.length"
            class="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2"
          >
            <div
              v-for="f in s.headline"
              :key="f.label"
              class="rounded-md bg-elevated/50 px-3 py-2"
            >
              <dt class="text-xs text-muted">
                {{ f.label }}
              </dt>
              <dd class="text-xl font-semibold whitespace-nowrap text-highlighted">
                {{ show(f) }}
              </dd>
            </div>
          </dl>

          <section
            v-for="b in s.breakdowns"
            :key="b.title"
            class="space-y-1.5"
          >
            <h3 class="flex items-baseline justify-between text-sm font-medium">
              {{ b.title }}
              <span class="text-xs font-normal text-muted">{{ b.parts.reduce((n, p) => n + p.value, 0).toLocaleString('en-GB') }} on your lists</span>
            </h3>
            <StatusBar :parts="b.parts" />
          </section>

          <!-- In the browser, so this week and this month are counted in your own time zone. -->
          <ClientOnly v-if="s.history">
            <section class="space-y-1.5">
              <h3 class="text-sm font-medium">
                Your history
              </h3>
              <dl class="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
                <div
                  v-for="f in historyCells(s.history)"
                  :key="f.label"
                  class="rounded-md bg-elevated/50 px-3 py-2"
                >
                  <dt class="text-xs text-muted">
                    {{ f.label }}
                  </dt>
                  <dd class="font-semibold whitespace-nowrap text-highlighted tabular-nums">
                    {{ f.value }}
                  </dd>
                </div>
              </dl>
            </section>
          </ClientOnly>

          <section
            v-if="s.ratings"
            class="space-y-1.5"
          >
            <h3 class="text-sm font-medium">
              Your ratings
            </h3>
            <RatingsChart :counts="s.ratings" />
          </section>

          <dl
            v-if="s.more.length"
            class="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-default pt-3"
          >
            <div
              v-for="f in s.more"
              :key="f.label"
            >
              <dt class="text-xs text-muted">
                {{ f.label }}
              </dt>
              <dd class="font-medium text-default">
                {{ show(f) }}
              </dd>
            </div>
          </dl>

          <details
            v-if="s.raw"
            class="text-xs"
          >
            <summary class="cursor-pointer text-muted">
              Source's answer
            </summary>
            <pre class="mt-2 max-h-64 overflow-auto rounded bg-elevated p-2">{{ JSON.stringify(s.raw, null, 2) }}</pre>
          </details>
        </UCard>
      </div>

      <section class="space-y-2">
        <h2 class="text-lg font-semibold">
          Marked from Tsuzuku
        </h2>
        <div class="grid gap-4 sm:grid-cols-3">
          <UCard
            v-for="w in data?.writes ?? []"
            :key="w.source"
            :ui="{ body: 'space-y-4' }"
          >
            <div class="flex items-center justify-between gap-2">
              <SourceName :source="w.source" />
              <UBadge
                v-if="w.failed"
                :label="`${w.failed} failed`"
                icon="i-lucide-circle-alert"
                color="error"
                variant="subtle"
                size="sm"
              />
              <span
                v-else
                class="flex items-center gap-1 text-xs text-muted"
              >
                <UIcon
                  name="i-lucide-circle-check"
                  class="size-3.5"
                />
                No failures
              </span>
            </div>

            <div class="flex items-end justify-between gap-4">
              <div>
                <p class="text-3xl font-semibold leading-none text-highlighted tabular-nums">
                  {{ w.month }}
                </p>
                <p class="mt-1 text-xs text-muted">
                  marks in 30 days
                </p>
              </div>
              <dl class="flex gap-4 text-end tabular-nums">
                <div>
                  <dt class="text-xs text-muted">
                    7 days
                  </dt>
                  <dd class="font-medium text-default">
                    {{ w.week }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted">
                    Year
                  </dt>
                  <dd class="font-medium text-default">
                    {{ w.year }}
                  </dd>
                </div>
              </dl>
            </div>

            <MarksChart
              v-if="w.year"
              :days="w.days"
            />
            <p
              v-else
              class="text-sm text-muted"
            >
              No marks from Tsuzuku yet.
            </p>
          </UCard>
        </div>
      </section>
    </UPageBody>
  </UContainer>
</template>
