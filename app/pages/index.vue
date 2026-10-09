<script setup lang="ts">
// Up Next (step 5): every show you are watching, one column per source, each with its own progress.
// Differences are flagged and left for you; no source is treated as correct (decisions #2, #10, #19).
useSeoMeta({ title: 'Up Next · Tsuzuku' })

const COLUMNS = ['trakt', 'simkl', 'mal'] as const

const { data, refresh, status } = await useFetch('/api/up-next')
const { data: statuses, refresh: refreshStatuses } = await useFetch('/api/sources/status')

async function reload() {
  await refresh()
  await refreshStatuses()
}

const rows = computed(() => data.value?.rows ?? [])
const onTrakt = computed(() => rows.value.filter(r => r.section === 'trakt'))
const other = computed(() => rows.value.filter(r => r.section === 'other'))
const otherNext = computed(() => other.value.filter(r => r.hasNext))
const otherCaughtUp = computed(() => other.value.filter(r => !r.hasNext))
const differing = computed(() => rows.value.filter(r => r.differs && !r.accepted).length)
const accepted = computed(() => rows.value.filter(r => r.accepted).length)
const description = computed(() => {
  const head = differing.value ? `${differing.value} ${differing.value === 1 ? 'show differs' : 'shows differ'} between sources.` : 'All sources agree.'
  return accepted.value ? `${head} ${accepted.value} accepted ${accepted.value === 1 ? 'difference' : 'differences'}.` : head
})
const showCaughtUp = ref(false)

// "Mark watched": the row, and the source clicked when the sources do not all agree.
const markTarget = ref<{ rowKey: string, title: string, source?: 'trakt' | 'simkl' | 'mal' } | null>(null)
const markOpen = ref(false)
function mark(row: { key: string, title: string }, source?: 'trakt' | 'simkl' | 'mal') {
  markTarget.value = { rowKey: row.key, title: row.title, source }
  markOpen.value = true
}

// Saved on the server; update the row here instead of fetching every source again.
function setAccepted(key: string, value: boolean) {
  const row = data.value?.rows.find(r => r.key === key)
  if (row) row.accepted = value
}

const chips = computed(() => (statuses.value ?? []).filter(s => (COLUMNS as readonly string[]).includes(s.source)))
</script>

<template>
  <UContainer class="py-8">
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
            :loading="status === 'pending'"
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

      <section
        v-for="group in [
          { title: 'Trakt up next', rows: onTrakt, hint: 'In Trakt\'s order.' },
          { title: 'Not in Trakt up next', rows: otherNext, hint: 'On Simkl or MAL with something to watch, by last activity.' }
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
          @accepted="setAccepted"
          @mark="mark"
        />
      </section>

      <section
        v-if="otherCaughtUp.length"
        class="space-y-2"
      >
        <UButton
          :label="`${showCaughtUp ? 'Hide' : 'Show'} caught up (${otherCaughtUp.length})`"
          :icon="showCaughtUp ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          color="neutral"
          variant="ghost"
          @click="showCaughtUp = !showCaughtUp"
        />
        <UpNextCards
          v-if="showCaughtUp"
          :rows="otherCaughtUp"
          @accepted="setAccepted"
          @mark="mark"
        />
      </section>
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
