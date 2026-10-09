<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

// Every write Tsuzuku sent to a source, newest first, with what the source said (step 6).
useSeoMeta({ title: 'Write log · Tsuzuku' })

const { data, refresh, status } = await useFetch('/api/write-log')
type LogRow = NonNullable<typeof data.value>[number]

const columns: TableColumn<LogRow>[] = [
  { accessorKey: 'at', header: 'When' },
  { accessorKey: 'source', header: 'Source' },
  { accessorKey: 'title', header: 'Show' },
  { accessorKey: 'summary', header: 'Change' },
  { accessorKey: 'result', header: 'Result' }
]

const exact = (at: string | Date) => new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
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
      <UTable
        :data="data ?? []"
        :columns="columns"
        empty="Nothing written yet."
        class="rounded-md border border-default"
      >
        <template #at-cell="{ row }">
          <span
            :title="exact(row.original.at)"
            class="whitespace-nowrap"
          >{{ relativeTime(String(row.original.at)) }}</span>
        </template>
        <template #source-cell="{ row }">
          <SourceName :source="row.original.source" />
        </template>
        <template #title-cell="{ row }">
          <div class="font-medium">
            {{ row.original.title }}
          </div>
          <div class="text-muted">
            {{ row.original.episode }}
          </div>
        </template>
        <template #summary-cell="{ row }">
          <span class="whitespace-normal">{{ row.original.summary }}</span>
        </template>
        <template #result-cell="{ row }">
          <UBadge
            :label="row.original.result === 'ok' ? 'done' : 'failed'"
            :color="row.original.result === 'ok' ? 'success' : 'error'"
            variant="subtle"
          />
          <div
            v-if="row.original.error"
            class="mt-1 text-sm text-error whitespace-normal"
          >
            {{ row.original.error }}
          </div>
        </template>
      </UTable>
    </UPageBody>
  </UContainer>
</template>
