<script setup lang="ts">
import { formatLabel, isSideStory } from '#shared/utils/formats'
import { episodeLabel } from '#shared/utils/source-links'

// One card per show (#54). Collapsed: poster, title, the next episode and the action. When the sources
// differ, each one's next episode stays on the card and the edge is marked, so a difference is never
// hidden behind "Details". Expanded: every source's own view, its own "mark watched", and accept / undo.
type Cell = NonNullable<InstanceType<typeof import('./UpNextCell.vue').default>['$props']['cell']>
type Source = 'trakt' | 'simkl' | 'mal'
interface Row {
  key: string
  title: string
  kind: string
  differs: boolean
  accepted: boolean
  agrees: boolean
  signature: string
  images: string[]
  cells: Partial<Record<Source, Cell>>
}
defineProps<{ rows: Row[] }>()
const emit = defineEmits<{ accepted: [key: string, accepted: boolean], mark: [row: { key: string, title: string }, source?: Source] }>()
const COLUMNS = ['trakt', 'simkl', 'mal'] as const
const toast = useToast()

const withEntry = (row: Row) => COLUMNS.flatMap(s => row.cells[s]?.entry ? [row.cells[s]!] : [])

// The episode the card leads with: the one the agreeing sources share (in Trakt's numbering), or the only
// source's. None when the sources differ: then each one's is shown.
function lead(row: Row) {
  const cells = withEntry(row)
  const shared = row.agrees ? cells.filter(c => c.state === 'in_sync') : !row.differs && cells.length === 1 ? cells : []
  if (!shared.length) return null
  const first = shared[0]!
  const next = first.traktNext ?? first.entry!.next
  const airedAt = shared.map(c => c.entry!.next?.airedAt).find(Boolean) ?? null
  const date = shortDate(airedAt)
  return {
    episode: next ? episodeLabel(next) : null,
    name: shared.map(c => c.entry!.next?.title).find(Boolean) ?? null,
    air: date ? { text: isFuture(airedAt) ? `airs ${date} (${relativeTime(airedAt)})` : `aired ${date}`, future: isFuture(airedAt) } : null
  }
}

// "Mark watched" on the card: every source when they agree, else the one source that can be marked when
// it is alone. Otherwise the per-source buttons are under "Details".
function action(row: Row): { source?: Source, label: string } | null {
  if (row.agrees) return { label: 'Mark watched' }
  if (row.differs) return null
  const markable = COLUMNS.filter(s => row.cells[s]?.entry?.next && !row.cells[s]!.blocked && !row.cells[s]!.stale)
  if (markable.length !== 1) return null
  return { source: markable[0], label: `Mark ${episodeLabel(row.cells[markable[0]!]!.entry!.next)} watched` }
}

// Per-source problems worth seeing without opening the card.
function flags(row: Row) {
  return COLUMNS.flatMap((s): { source: Source, label: string, color: 'warning' | 'neutral' }[] => {
    const c = row.cells[s]
    if (!c) return []
    if (c.blocked) return [{ source: s, label: 'rate limited', color: 'warning' }]
    if (c.stale) return [{ source: s, label: 'stale', color: 'neutral' }]
    return []
  })
}
// Progress at the bottom of the card, from one source, named by its logo: Simkl first (it counts a show's
// seasons together; for anime, the entry's own episodes), else Trakt, else MAL.
function progress(row: Row) {
  const c = (['simkl', 'trakt', 'mal'] as const).map(s => row.cells[s]).find(c => c?.entry && c.entry.episodes)
  if (!c) return null
  const { watched, episodes } = c.entry!
  return { source: c.source, watched: Math.min(watched, episodes!), episodes: episodes! }
}
const sideStory = (row: Row) => withEntry(row).map(c => c.entry!.format).find(f => isSideStory(f)) ?? null
const notPlaced = (row: Row) => COLUMNS.some(s => row.cells[s]?.state === 'not_placed')

const open = reactive(new Set<string>())
const toggle = (key: string) => open.has(key) ? open.delete(key) : open.add(key)
// A click anywhere on the card opens or closes it, except on its buttons and links (mark watched, accept,
// a source's page) and when it ends a text selection. The "Details" button stays for the keyboard.
function onCardClick(key: string, e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a, button, input, label, [role="checkbox"]')) return
  if (window.getSelection()?.toString()) return
  toggle(key)
}

const busy = ref<string | null>(null)
async function setAccepted(row: Row, accepted: boolean) {
  busy.value = row.key
  try {
    if (accepted) await $fetch('/api/up-next/accept', { method: 'POST', body: { rowKey: row.key, signature: row.signature } })
    else await $fetch('/api/up-next/undo-accept', { method: 'POST', body: { rowKey: row.key } })
    emit('accepted', row.key, accepted)
  } catch (e) {
    toast.add({ title: 'Could not save', description: String((e as Error).message), color: 'error' })
  } finally {
    busy.value = null
  }
}

// Images that failed to load, so the next candidate is tried (a source's image server can refuse).
const failed = reactive(new Set<string>())
const imageFor = (images: string[] | undefined) => images?.find(u => !failed.has(u)) ?? null
</script>

<template>
  <div class="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
    <article
      v-for="row in rows"
      :key="row.key"
      class="rounded-md border border-default border-s-4 p-3 cursor-pointer transition-colors hover:bg-elevated/40"
      :class="row.differs && !row.accepted ? 'border-s-warning' : row.accepted ? 'border-s-accented' : 'border-s-default'"
      @click="onCardClick(row.key, $event)"
    >
      <div class="flex gap-3">
        <!-- Client-only: an image that fails while the server-rendered page loads would otherwise fail
             before the error handler exists, and the next image would never be tried. -->
        <ClientOnly>
          <img
            v-if="imageFor(row.images)"
            :src="imageFor(row.images)!"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
            class="w-20 h-30 sm:w-24 sm:h-36 shrink-0 rounded object-cover bg-elevated"
            @error="failed.add(imageFor(row.images)!)"
          >
          <div
            v-else
            class="w-20 h-30 sm:w-24 sm:h-36 shrink-0 rounded bg-elevated"
          />
          <template #fallback>
            <div class="w-20 h-30 sm:w-24 sm:h-36 shrink-0 rounded bg-elevated" />
          </template>
        </ClientOnly>

        <div class="min-w-0 flex-1 flex flex-col gap-1.5">
          <h3 class="font-medium leading-snug line-clamp-2 break-words">
            {{ row.title }}
          </h3>

          <div
            v-if="row.differs || sideStory(row) || notPlaced(row) || flags(row).length"
            class="flex flex-wrap gap-1"
          >
            <UBadge
              v-if="row.differs"
              :label="row.accepted ? 'differs, accepted' : 'differs'"
              :color="row.accepted ? 'neutral' : 'warning'"
              variant="subtle"
              size="sm"
            />
            <UBadge
              v-if="sideStory(row)"
              :label="formatLabel(sideStory(row)!)"
              color="neutral"
              variant="outline"
              size="sm"
            />
            <UBadge
              v-if="notPlaced(row)"
              label="season not set"
              color="primary"
              variant="subtle"
              size="sm"
            />
            <UBadge
              v-for="f in flags(row)"
              :key="f.source"
              :color="f.color"
              variant="outline"
              size="sm"
            >
              <SourceIcon :source="f.source" />
              {{ f.label }}
            </UBadge>
          </div>

          <div
            v-if="lead(row)"
            class="leading-snug"
          >
            <div class="text-base">
              <span class="font-medium">{{ lead(row)!.episode ?? 'caught up' }}</span>
              <span
                v-if="lead(row)!.name"
                class="text-highlighted"
              > · “{{ lead(row)!.name }}”</span>
            </div>
            <div
              v-if="lead(row)!.air"
              class="text-sm"
              :class="lead(row)!.air!.future ? 'text-warning' : 'text-muted'"
            >
              {{ lead(row)!.air!.text }}
            </div>
          </div>
          <div
            v-else
            class="flex flex-wrap gap-x-3 gap-y-0.5 text-sm"
          >
            <span
              v-for="c in withEntry(row)"
              :key="c.source"
              class="inline-flex items-center gap-1"
              :title="c.traktNext && c.source !== 'trakt' ? `Trakt ${episodeLabel(c.traktNext)}` : undefined"
            >
              <SourceIcon :source="c.source" />
              <span :class="c.state === 'differs' && !row.accepted ? 'font-medium' : 'text-muted'">{{ c.entry!.next ? episodeLabel(c.entry!.next) : 'caught up' }}</span>
            </span>
          </div>

          <div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <UButton
              v-if="action(row)"
              :label="action(row)!.label"
              :title="action(row)!.source ? `Mark on ${SOURCE_LABELS[action(row)!.source!]}` : `Mark on every source`"
              :icon="action(row)!.source ? SOURCE_ICONS[action(row)!.source!]!.icon : 'i-lucide-check-check'"
              variant="soft"
              size="sm"
              @click="emit('mark', row, action(row)!.source)"
            />
            <UButton
              :label="open.has(row.key) ? 'Less' : 'Details'"
              :trailing-icon="open.has(row.key) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-expanded="open.has(row.key)"
              @click="toggle(row.key)"
            />
          </div>
        </div>
      </div>

      <div
        v-if="progress(row)"
        class="mt-3 flex items-center gap-2 text-xs text-muted"
        :title="`${progress(row)!.watched} of ${progress(row)!.episodes} episodes watched on ${SOURCE_LABELS[progress(row)!.source]}`"
      >
        <SourceIcon :source="progress(row)!.source" />
        <UProgress
          :model-value="progress(row)!.watched"
          :max="progress(row)!.episodes"
          size="xs"
          class="flex-1"
        />
        <span class="tabular-nums">{{ progress(row)!.watched }}/{{ progress(row)!.episodes }}</span>
      </div>

      <div
        v-if="open.has(row.key)"
        class="mt-3 border-t border-default divide-y divide-default"
      >
        <template
          v-for="c in COLUMNS"
          :key="c"
        >
          <UpNextCell
            v-if="row.cells[c]"
            :cell="row.cells[c]"
            :kind="row.kind"
            :accepted="row.accepted"
            :markable="!row.agrees"
            class="py-2.5"
            @mark="emit('mark', row, c)"
          />
        </template>
        <div
          v-if="row.differs"
          class="pt-2.5"
        >
          <UButton
            v-if="!row.accepted"
            label="Accept difference"
            icon="i-lucide-check"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="busy === row.key"
            @click="setAccepted(row, true)"
          />
          <div
            v-else
            class="flex flex-wrap items-center gap-1 text-xs text-muted"
          >
            Difference accepted ·
            <UButton
              label="Undo"
              color="neutral"
              variant="link"
              size="xs"
              class="p-0"
              :loading="busy === row.key"
              @click="setAccepted(row, false)"
            />
          </div>
        </div>
      </div>
    </article>
    <div
      v-if="!rows.length"
      class="col-span-full rounded-md border border-default px-4 py-3 text-sm text-muted"
    >
      Nothing here.
    </div>
  </div>
</template>
