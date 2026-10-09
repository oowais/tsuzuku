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

          <UAlert
            v-if="s.error"
            :color="s.groups.length ? 'neutral' : 'warning'"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="s.groups.length ? `Showing earlier numbers: ${s.error}` : s.error"
          />
          <p
            v-else-if="!s.groups.length"
            class="text-sm text-muted"
          >
            No figures in the answer.
          </p>

          <section
            v-for="g in s.groups"
            :key="g.title"
          >
            <h3 class="mb-1.5 text-xs font-medium uppercase tracking-wide text-dimmed">
              {{ g.title }}
            </h3>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div
                v-for="f in g.figures"
                :key="f.label"
              >
                <dt class="text-xs text-muted">
                  {{ f.label }}
                </dt>
                <dd class="text-base font-semibold tabular-nums text-highlighted">
                  {{ show(f) }}
                </dd>
              </div>
            </dl>
          </section>

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
        <div class="rounded-md border border-default overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-muted">
              <tr class="border-b border-default">
                <th class="px-4 py-2 text-start font-medium">
                  Source
                </th>
                <th class="px-4 py-2 text-end font-medium">
                  7 days
                </th>
                <th class="px-4 py-2 text-end font-medium">
                  30 days
                </th>
                <th class="px-4 py-2 text-end font-medium">
                  Year
                </th>
                <th class="px-4 py-2 text-end font-medium">
                  Failed (30 days)
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default tabular-nums">
              <tr
                v-for="w in data?.writes ?? []"
                :key="w.source"
              >
                <td class="px-4 py-2">
                  <SourceName :source="w.source" />
                </td>
                <td class="px-4 py-2 text-end">
                  {{ w.week }}
                </td>
                <td class="px-4 py-2 text-end">
                  {{ w.month }}
                </td>
                <td class="px-4 py-2 text-end">
                  {{ w.year }}
                </td>
                <td
                  class="px-4 py-2 text-end"
                  :class="w.failed ? 'text-error' : 'text-muted'"
                >
                  {{ w.failed }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </UPageBody>
  </UContainer>
</template>
