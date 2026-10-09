<script setup lang="ts">
// "Mark next watched": a preview per source, read fresh from the sources, then a confirm. Nothing is written
// before the confirm. A failed source shows its error with a retry; there is no queue (decisions #3, #13).
type ListSource = 'trakt' | 'simkl' | 'mal'
interface Step { source: ListSource, title: string, episode: string, summary: string, expected: string, airsAt: { date: string, by: ListSource } | null }
interface Plan { rowKey: string, title: string, mode: 'all' | 'one', steps: Step[], skipped: { source: ListSource, reason: string }[] }
interface Outcome { source: ListSource, ok: boolean, error?: string }

const props = defineProps<{ rowKey: string, source?: ListSource, title: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ marked: [] }>()

const plan = ref<Plan | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(false)
const picked = ref<Set<ListSource>>(new Set())
const outcomes = ref<Partial<Record<ListSource, Outcome>>>({})
const saving = ref(false)

const errorText = (e: unknown) => (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message

async function preview() {
  loading.value = true
  loadError.value = null
  outcomes.value = {}
  try {
    plan.value = await $fetch<Plan>('/api/mark/preview', { method: 'POST', body: { rowKey: props.rowKey, source: props.source } })
    picked.value = new Set(plan.value.steps.map(s => s.source))
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

async function confirm() {
  if (!plan.value || !pending.value.length) return
  saving.value = true
  try {
    const res = await $fetch<{ outcomes: Outcome[] }>('/api/mark/confirm', {
      method: 'POST',
      body: { rowKey: plan.value.rowKey, source: props.source, steps: pending.value.map(s => ({ source: s.source, expected: s.expected })) }
    })
    outcomes.value = { ...outcomes.value, ...Object.fromEntries(res.outcomes.map(o => [o.source, o])) }
    if (res.outcomes.some(o => o.ok)) emit('marked')
    if (res.outcomes.every(o => o.ok)) open.value = false
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
    :description="title"
  >
    <template #body>
      <div
        v-if="loading"
        class="text-sm text-muted"
      >
        Reading the sources…
      </div>
      <UAlert
        v-else-if="loadError"
        color="error"
        icon="i-lucide-circle-alert"
        :title="loadError"
      />
      <div
        v-else-if="plan"
        class="space-y-3"
      >
        <p class="text-sm text-muted">
          {{ plan.mode === 'all' ? 'The sources agree on the next episode. Each one is marked in its own numbering:' : 'Only this source is marked:' }}
        </p>
        <div
          v-for="s in plan.steps"
          :key="s.source"
          class="rounded-md border border-default p-3 space-y-1"
        >
          <div class="flex items-center gap-2">
            <UCheckbox
              v-if="plan.mode === 'all'"
              :model-value="picked.has(s.source)"
              :disabled="saving || !!outcomes[s.source]?.ok"
              @update:model-value="toggle(s.source, $event)"
            />
            <span class="font-medium">{{ SOURCE_LABELS[s.source] }}</span>
            <span class="text-sm text-muted truncate">{{ s.title }} · {{ s.episode }}</span>
          </div>
          <div class="text-sm">
            {{ s.summary }}
          </div>
          <!-- Not refused: a source's database can lag behind the real airing (#43). -->
          <div
            v-if="s.airsAt"
            class="flex items-start gap-1.5 text-sm text-warning"
          >
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0"
            />
            <span>{{ SOURCE_LABELS[s.airsAt.by] }} dates this episode {{ shortDate(s.airsAt.date) }} ({{ relativeTime(s.airsAt.date) }}). Mark it only if you've already watched it.</span>
          </div>
          <div
            v-if="outcomes[s.source]?.ok"
            class="text-sm text-success"
          >
            Done
          </div>
          <div
            v-else-if="outcomes[s.source]"
            class="text-sm text-error"
          >
            {{ outcomes[s.source]!.error }}
          </div>
        </div>
        <div
          v-for="s in plan.skipped"
          :key="s.source"
          class="text-sm text-muted"
        >
          {{ SOURCE_LABELS[s.source] }}: {{ s.reason }}
        </div>
        <div
          v-if="!plan.steps.length"
          class="text-sm text-muted"
        >
          Nothing can be marked right now.
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2">
        <UButton
          v-if="!allDone"
          :label="anyFailed ? 'Retry' : 'Mark watched'"
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
