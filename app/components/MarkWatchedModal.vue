<script setup lang="ts">
import { localDay } from '#shared/utils/log-groups'

// "Mark next watched": a preview per source, read fresh from the sources, then a confirm. Nothing is written
// before the confirm. A failed source shows its error with a retry; there is no queue (decisions #3, #13).
type ListSource = 'trakt' | 'simkl' | 'mal'
type AfterStatus = 'completed' | 'hold' | 'dropped'
interface Step {
  source: ListSource
  title: string
  episode: string
  summary: string
  note: string
  expected: string
  airsAt: { date: string, by: ListSource } | null
  after: { options: AfterStatus[], suggested: AfterStatus | null } | null
  rating: { scope: 'show' | 'season', current: number | null, unknown: boolean } | null
}
interface Plan {
  rowKey: string
  title: string
  mode: 'all' | 'one'
  episode: { label: string, name: string | null, airedAt: string | null } | null
  steps: Step[]
  skipped: { source: ListSource, reason: string }[]
  // The row moved on since the page loaded (another device, or the source's own site), with Tsuzuku's last mark.
  changed: { lastMark: { episode: string, at: string } | null } | null
}
interface Outcome { source: ListSource, ok: boolean, error?: string, listStatus?: string | null, ratingError?: string }

const props = defineProps<{ rowKey: string, source?: ListSource, title: string, signature?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ marked: [], stale: [] }>()

const plan = ref<Plan | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(false)
const picked = ref<Set<ListSource>>(new Set())
const outcomes = ref<Partial<Record<ListSource, Outcome>>>({})
const saving = ref(false)

// The list status to set with a source's last episode (#52); 'leave' leaves it to the source.
const afterChoice = ref<Partial<Record<ListSource, AfterStatus | 'leave'>>>({})
const afterItems = (s: Step) => [
  // Simkl files a finished item itself (Completed); MAL stays on Watching.
  { label: s.source === 'simkl' ? 'Leave to Simkl' : 'Keep watching', value: 'leave' },
  ...s.after!.options.map(o => ({ label: LIST_STATUS_LABELS[o]!, value: o }))
]
// The note without the status the preview suggested; the picker shows the status.
const baseNote = (s: Step) => s.after ? s.note.replace(/, [a-z ]+$/, '') : s.note

// A score with the last episode (#65): skipped by default (0), one number for every source that offers it, or
// a different one per source when asked for. Each source rates its own thing (the whole show, or one MAL
// season), so each row says which.
const SCORES = [{ label: 'Don\'t rate', value: 0 }, ...Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))]
const sharedScore = ref(0)
const splitRating = ref(false)
const rateValue = ref<Partial<Record<ListSource, number>>>({})
const ratable = computed(() => (plan.value?.steps ?? []).filter(s => s.rating && !outcomes.value[s.source]?.ok))
function setShared(v: number) {
  sharedScore.value = v
  rateValue.value = Object.fromEntries(ratable.value.map(s => [s.source, v]))
}
function setSplit(on: boolean | 'indeterminate') {
  splitRating.value = on === true
  if (on === true) rateValue.value = Object.fromEntries(ratable.value.map(s => [s.source, sharedScore.value]))
}
// The score a source gets, or null to leave its rating alone.
const ratingFor = (s: Step) => (s.rating ? (splitRating.value ? rateValue.value[s.source] : sharedScore.value) || null : null)
const SCOPE_LABELS = { show: 'whole show', season: 'this season only' }

// "21:04" in the browser's time zone.
const clock = (at: string) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const errorText = (e: unknown) => (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message

async function preview() {
  loading.value = true
  loadError.value = null
  outcomes.value = {}
  try {
    plan.value = await $fetch<Plan>('/api/mark/preview', { method: 'POST', body: { rowKey: props.rowKey, source: props.source, signature: props.signature } })
    // The page behind is out of date: reload it, so the card matches this preview.
    if (plan.value.changed) emit('stale')
    picked.value = new Set(plan.value.steps.map(s => s.source))
    afterChoice.value = Object.fromEntries(plan.value.steps.filter(s => s.after).map(s => [s.source, s.after!.suggested ?? 'leave']))
    splitRating.value = false
    setShared(0)
  } catch (e) {
    plan.value = null
    loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}
watch(open, (o) => {
  if (o) preview()
}, { immediate: true })

function toggle(source: ListSource, on: boolean | 'indeterminate') {
  const next = new Set(picked.value)
  if (on === true) next.add(source)
  else next.delete(source)
  picked.value = next
}

// Steps still to write: picked, and not already written in this preview.
const pending = computed(() => (plan.value?.steps ?? []).filter(s => picked.value.has(s.source) && !outcomes.value[s.source]?.ok))
const anyFailed = computed(() => Object.values(outcomes.value).some(o => o && !o.ok))
const allDone = computed(() => !!plan.value && Object.keys(outcomes.value).length > 0 && !pending.value.length)

// In "all" mode a click anywhere on a source's row ticks or unticks it (the checkbox handles its own clicks).
const rowToggles = (source: ListSource) => plan.value?.mode === 'all' && !saving.value && !outcomes.value[source]?.ok
function onRowClick(source: ListSource, e: MouseEvent) {
  if (!rowToggles(source) || (e.target as HTMLElement).closest('button')) return
  toggle(source, !picked.value.has(source))
}

// A future date from any source warns once, under the episode (#43: marking stays possible, a source's
// database can lag behind the real airing).
const future = computed(() => plan.value?.steps.find(s => s.airsAt)?.airsAt ?? null)
const aired = computed(() => {
  const at = plan.value?.episode?.airedAt
  return at && !isFuture(at) ? shortDate(at) : null
})
const confirmLabel = computed(() => {
  if (anyFailed.value) return 'Retry'
  if (plan.value?.mode === 'one' && plan.value.steps[0]) return `Mark watched on ${SOURCE_LABELS[plan.value.steps[0].source]}`
  const n = pending.value.length
  return `Mark watched on ${n} ${n === 1 ? 'source' : 'sources'}`
})

async function confirm() {
  if (!plan.value || !pending.value.length) return
  saving.value = true
  try {
    const res = await $fetch<{ outcomes: Outcome[] }>('/api/mark/confirm', {
      method: 'POST',
      body: {
        rowKey: plan.value.rowKey,
        source: props.source,
        today: localDay(new Date()),
        steps: pending.value.map(s => ({
          source: s.source,
          expected: s.expected,
          ...(s.after ? { status: afterChoice.value[s.source] === 'leave' ? null : afterChoice.value[s.source] } : {}),
          ...(ratingFor(s) ? { rating: ratingFor(s) } : {})
        }))
      }
    })
    outcomes.value = { ...outcomes.value, ...Object.fromEntries(res.outcomes.map(o => [o.source, o])) }
    if (res.outcomes.some(o => o.ok)) emit('marked')
    // A failed rating keeps the modal open so its error is read.
    if (res.outcomes.every(o => o.ok && !o.ratingError)) open.value = false
  } catch (e) {
    for (const s of pending.value) outcomes.value = { ...outcomes.value, [s.source]: { source: s.source, ok: false, error: errorText(e) } }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Mark watched"
  >
    <template #body>
      <div
        v-if="loading"
        class="text-sm text-muted"
      >
        Loading…
      </div>
      <UAlert
        v-else-if="loadError"
        color="error"
        icon="i-lucide-circle-alert"
        :title="loadError"
      />
      <div
        v-else-if="plan"
        class="space-y-4"
      >
        <div>
          <div class="text-xl font-semibold text-highlighted leading-snug">
            {{ plan.episode?.label ?? 'Next episode' }}<template v-if="plan.episode?.name">
              · “{{ plan.episode.name }}”
            </template>
          </div>
          <div class="text-sm text-muted">
            {{ title }}<template v-if="aired">
              · aired {{ aired }}
            </template>
          </div>
          <UAlert
            v-if="plan.changed"
            color="warning"
            variant="subtle"
            icon="i-lucide-refresh-ccw"
            class="mt-3"
            title="Changed since this page loaded"
            :description="plan.changed.lastMark
              ? `${plan.changed.lastMark.episode} was marked at ${clock(plan.changed.lastMark.at)}, so the next episode is now the one above. The list behind is reloaded.`
              : 'This show moved on, maybe on the source\'s own site or app, so the next episode is now the one above. The list behind is reloaded.'"
          />
          <div
            v-if="future"
            class="mt-2 flex items-start gap-1.5 text-sm text-warning"
          >
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0"
            />
            <span>Airs {{ shortDate(future.date) }} ({{ relativeTime(future.date) }}) on <SourceName :source="future.by" />. Mark it only if you've already watched it.</span>
          </div>
        </div>

        <div
          v-if="ratable.length"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted"
        >
          <span>Your rating</span>
          <USelect
            :model-value="sharedScore"
            :items="SCORES"
            :disabled="saving"
            size="xs"
            class="w-32"
            @update:model-value="setShared"
          />
          <UCheckbox
            v-if="ratable.length > 1"
            :model-value="splitRating"
            :disabled="saving"
            label="Different per source"
            @update:model-value="setSplit"
          />
        </div>

        <ul class="rounded-md border border-default divide-y divide-default">
          <li
            v-for="s in plan.steps"
            :key="s.source"
          >
            <div
              class="flex items-start gap-3 px-3 py-2.5"
              :class="rowToggles(s.source) ? 'cursor-pointer hover:bg-elevated/50' : ''"
              @click="onRowClick(s.source, $event)"
            >
              <UCheckbox
                v-if="plan.mode === 'all'"
                :model-value="picked.has(s.source)"
                :disabled="saving || !!outcomes[s.source]?.ok"
                class="mt-0.5"
                @update:model-value="toggle(s.source, $event)"
              />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <SourceName
                    :source="s.source"
                    class="w-16 text-sm text-muted"
                  />
                  <span class="font-semibold">{{ s.episode }}</span>
                  <span
                    v-if="s.title !== title"
                    :title="s.title"
                    class="min-w-0 line-clamp-2 break-words text-sm text-muted"
                  >{{ s.title }}</span>
                </div>
                <div
                  v-if="s.after && !outcomes[s.source]?.ok"
                  class="mt-1.5 flex items-center gap-2 text-sm text-muted"
                >
                  After this
                  <USelect
                    v-model="afterChoice[s.source]"
                    :items="afterItems(s)"
                    :disabled="saving"
                    size="xs"
                    class="w-36"
                  />
                  <span v-if="s.source === 'mal' && afterChoice[s.source] === 'completed'">finish date today, unless MAL has one</span>
                </div>
                <div
                  v-if="s.source === 'mal' && s.expected.startsWith('0|') && !outcomes[s.source]?.ok"
                  class="mt-1.5 text-sm text-muted"
                >
                  Start date today, unless MAL has one
                </div>
                <div
                  v-if="s.rating && !outcomes[s.source]?.ok"
                  class="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted"
                >
                  <template v-if="splitRating">
                    Rate
                    <USelect
                      v-model="rateValue[s.source]"
                      :items="SCORES"
                      :disabled="saving"
                      size="xs"
                      class="w-32"
                    />
                  </template>
                  <span>{{ SCOPE_LABELS[s.rating.scope] }}<template v-if="s.rating.unknown"> · current rating unknown</template><template v-else-if="s.rating.current"> · now {{ s.rating.current }}</template><template v-else> · not rated</template></span>
                </div>
                <div
                  v-if="outcomes[s.source]?.ratingError"
                  class="text-sm text-error"
                >
                  Marked, but the rating failed: {{ outcomes[s.source]!.ratingError }}
                </div>
                <div
                  v-if="outcomes[s.source] && !outcomes[s.source]!.ok"
                  class="text-sm text-error"
                >
                  {{ outcomes[s.source]!.error }}
                </div>
              </div>
              <span
                v-if="outcomes[s.source]?.ok"
                class="flex items-center gap-1 text-sm text-success shrink-0"
              >
                <UIcon
                  name="i-lucide-check"
                  class="size-4"
                />
                done<template v-if="outcomes[s.source]!.listStatus && outcomes[s.source]!.listStatus !== 'watching'">
                  · {{ LIST_STATUS_LABELS[outcomes[s.source]!.listStatus!] ?? outcomes[s.source]!.listStatus }}
                </template>
              </span>
              <span
                v-else
                class="text-sm text-dimmed shrink-0"
              >{{ baseNote(s) }}</span>
            </div>
          </li>
          <li
            v-for="s in plan.skipped"
            :key="s.source"
            class="px-3 py-2 text-sm text-muted"
          >
            <SourceName :source="s.source" />: {{ s.reason }}
          </li>
          <li
            v-if="!plan.steps.length"
            class="px-3 py-2 text-sm text-muted"
          >
            Nothing can be marked right now.
          </li>
        </ul>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2">
        <UButton
          v-if="!allDone"
          :label="confirmLabel"
          :icon="anyFailed ? 'i-lucide-refresh-cw' : 'i-lucide-check'"
          :disabled="loading || !pending.length"
          :loading="saving"
          @click="confirm"
        />
        <UButton
          :label="allDone ? 'Close' : 'Cancel'"
          color="neutral"
          variant="outline"
          @click="open = false"
        />
      </div>
    </template>
  </UModal>
</template>
