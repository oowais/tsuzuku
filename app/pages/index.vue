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
const differing = computed(() => rows.value.filter(r => r.differs).length)
const showCaughtUp = ref(false)

const chips = computed(() => (statuses.value ?? []).filter(s => (COLUMNS as readonly string[]).includes(s.source)))
</script>

<template>
  <UContainer class="py-8">
    <UPageHeader
      title="Up Next"
      :description="differing ? `${differing} ${differing === 1 ? 'show differs' : 'shows differ'} between sources.` : 'All sources agree.'"
    >
      <template #links>
        <div class="flex flex-wrap items-center gap-2">
          <span
            v-for="s in chips"
            :key="s.source"
            class="flex items-center gap-1 text-sm"
          >
            {{ SOURCE_LABELS[s.source] }}
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
        <UpNextTable :rows="group.rows" />
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
        <UpNextTable
          v-if="showCaughtUp"
          :rows="otherCaughtUp"
        />
      </section>
    </UPageBody>
  </UContainer>
</template>
