<script setup lang="ts">
import { episodeLabel, episodeUrl, itemUrl, type LinkTarget } from '#shared/utils/source-links'

// One source's view of a show (decision #19): its own title, progress and next episode, and how it
// compares with the other sources. Everything links to the source (decision #24).
interface CellEntry extends LinkTarget {
  title: string
  format: string | null
  watched: number
  episodes: number | null
  next: { season: number | null, number: number, title: string | null } | null
}
const props = defineProps<{
  cell: {
    source: 'trakt' | 'simkl' | 'mal'
    state: string
    entry: CellEntry | null
    ref: { title: string, traktSlug?: string, simkl?: number, mal?: number } | null
    traktNext: { season: number | null, number: number } | null
    stale: boolean
    blocked: boolean
  } | undefined
  kind: string
  // The row's difference is accepted: shown, but not flagged.
  accepted?: boolean
  // Offer "mark watched" for this source alone (the sources on the row do not all agree).
  markable?: boolean
}>()
const emit = defineEmits<{ mark: [] }>()

const STATES: Record<string, { label: string, color: 'success' | 'warning' | 'neutral' | 'primary' } | null> = {
  in_sync: { label: 'in sync', color: 'success' },
  differs: { label: 'differs', color: 'warning' },
  caught_up: { label: 'caught up', color: 'neutral' },
  not_placed: { label: 'season not set', color: 'primary' },
  alone: null,
  not_in_list: null,
  unmapped: null
}

const label = computed(() => SOURCE_LABELS[props.cell?.source ?? ''] ?? '')
const state = computed(() => {
  if (!props.cell) return null
  if (props.cell.state === 'differs' && props.accepted) return { label: 'differs, accepted', color: 'neutral' as const }
  return STATES[props.cell.state]
})

// A linked show that is not on this source's list: link to it by its stored ID.
const refUrl = computed(() => {
  const r = props.cell?.ref
  if (!r || !props.cell) return null
  const kind = props.cell.source === 'mal' || props.kind === 'anime' ? 'anime' : 'show'
  return itemUrl({ source: props.cell.source, kind, ids: { traktSlug: r.traktSlug, simkl: r.simkl, mal: r.mal } })
})
</script>

<template>
  <div
    v-if="!cell"
    class="text-sm text-dimmed"
  >
    —
  </div>
  <div
    v-else
    class="min-w-0 space-y-0.5 text-sm"
  >
    <div class="flex flex-wrap items-center gap-1">
      <span class="text-xs text-muted sm:hidden">{{ label }}</span>
      <UBadge
        v-if="state"
        :label="state.label"
        :color="state.color"
        variant="subtle"
        size="sm"
      />
      <UBadge
        v-if="cell.blocked"
        label="rate limited"
        color="warning"
        variant="outline"
        size="sm"
      />
      <UBadge
        v-else-if="cell.stale"
        label="stale"
        color="neutral"
        variant="outline"
        size="sm"
      />
    </div>

    <template v-if="cell.entry">
      <SourceLinks
        :links="[{ label: cell.entry.title, url: itemUrl(cell.entry) }]"
        class="block truncate"
      />
      <div class="text-muted">
        {{ cell.entry.watched }}/{{ cell.entry.episodes ?? '?' }}
        <template v-if="cell.entry.next">
          · next
          <SourceLinks :links="[{ label: episodeLabel(cell.entry.next), url: episodeUrl(cell.entry, cell.entry.next) }]" />
          <span
            v-if="cell.traktNext && cell.source !== 'trakt'"
            class="text-dimmed"
          > (Trakt {{ episodeLabel(cell.traktNext) }})</span>
        </template>
      </div>
    </template>

    <div
      v-else-if="cell.state === 'not_in_list'"
      class="text-muted"
    >
      not on your
      <SourceLinks :links="[{ label: `${label} list`, url: refUrl }]" />
      <span v-if="cell.ref?.title"> ({{ cell.ref.title }})</span>
    </div>

    <div
      v-else-if="cell.state === 'unmapped'"
      class="text-muted"
    >
      not linked ·
      <ULink
        to="/mappings"
        class="underline decoration-dotted underline-offset-2"
      >mappings</ULink>
    </div>

    <UButton
      v-if="markable && cell.entry?.next && !cell.blocked"
      :label="`Mark ${episodeLabel(cell.entry.next)} watched`"
      icon="i-lucide-eye"
      color="neutral"
      variant="outline"
      size="xs"
      class="mt-1"
      :disabled="cell.stale"
      :title="cell.stale ? 'Showing cached data; refresh first' : undefined"
      @click="emit('mark')"
    />

    <ULink
      v-if="cell.state === 'not_placed'"
      to="/mappings"
      class="text-xs underline decoration-dotted underline-offset-2"
    >set the Trakt season</ULink>
  </div>
</template>
