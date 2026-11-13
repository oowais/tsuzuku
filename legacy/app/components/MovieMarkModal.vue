<script setup lang="ts">
import { localDay } from "#shared/utils/log-groups";

// "Mark watched" for a movie (#17): what each source would do, then a confirm (decision #3). Sources with the movie
// on a list are ticked; a source that has it on no list is offered unticked. A score is left out unless picked,
// and then goes to every source marked. Nothing is written before the confirm.
type Source = "trakt" | "simkl" | "mal";
interface Step {
  source: Source;
  title: string;
  summary: string;
  expected: string;
  optional: boolean;
  currentRating: number | null;
}
interface Plan {
  rowKey: string;
  title: string;
  steps: Step[];
  skipped: { source: Source; reason: string }[];
}
interface Outcome {
  source: Source;
  ok: boolean;
  error?: string;
  retryAfter?: number | null;
  ratingError?: string;
}

const props = defineProps<{ rowKey: string; title: string }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ marked: [] }>();

const plan = ref<Plan | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const picked = ref<Set<Source>>(new Set());
const outcomes = ref<Partial<Record<Source, Outcome>>>({});
const saving = ref(false);

const SCORES = [
  { label: "Don't rate", value: 0 },
  ...Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), value: i + 1 })),
];
const score = ref(0);

const errorText = (e: unknown) =>
  (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message;

async function preview() {
  loading.value = true;
  loadError.value = null;
  outcomes.value = {};
  score.value = 0;
  try {
    plan.value = await $fetch<Plan>("/api/movies/mark/preview", {
      method: "POST",
      body: { rowKey: props.rowKey },
    });
    picked.value = new Set(plan.value.steps.filter((s) => !s.optional).map((s) => s.source));
  } catch (e) {
    plan.value = null;
    loadError.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

watch(
  open,
  (o) => {
    if (o) preview();
  },
  { immediate: true },
);

function toggle(source: Source, on: boolean | "indeterminate") {
  const next = new Set(picked.value);
  if (on === true) next.add(source);
  else next.delete(source);
  picked.value = next;
}

const pending = computed(() =>
  (plan.value?.steps ?? []).filter(
    (s) => picked.value.has(s.source) && !outcomes.value[s.source]?.ok,
  ),
);
const anyFailed = computed(() => Object.values(outcomes.value).some((o) => o && !o.ok));
const allDone = computed(
  () => !!plan.value && Object.keys(outcomes.value).length > 0 && !pending.value.length,
);
const currentScores = computed(() =>
  (plan.value?.steps ?? []).filter((s) => s.currentRating !== null),
);

async function confirm() {
  if (!plan.value || !pending.value.length) return;
  saving.value = true;
  try {
    const res = await $fetch<{ outcomes: Outcome[] }>("/api/movies/mark/confirm", {
      method: "POST",
      body: {
        rowKey: plan.value.rowKey,
        steps: pending.value.map((s) => ({ source: s.source, expected: s.expected })),
        rating: score.value || null,
        today: localDay(new Date()),
      },
    });
    outcomes.value = {
      ...outcomes.value,
      ...Object.fromEntries(res.outcomes.map((o) => [o.source, o])),
    };
    if (res.outcomes.some((o) => o.ok)) emit("marked");
    if (res.outcomes.every((o) => o.ok && !o.ratingError)) open.value = false;
  } catch (e) {
    for (const s of pending.value)
      outcomes.value = {
        ...outcomes.value,
        [s.source]: { source: s.source, ok: false, error: errorText(e) },
      };
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Mark watched" :description="title">
    <template #body>
      <div class="space-y-4">
        <UAlert v-if="loadError" color="error" icon="i-lucide-circle-alert" :title="loadError" />
        <div v-else-if="loading" class="text-sm text-muted">Loading…</div>

        <template v-else-if="plan">
          <div
            v-if="plan.steps.length"
            class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted"
          >
            <span>Your rating</span>
            <USelect v-model="score" :items="SCORES" :disabled="saving" size="xs" class="w-32" />
            <span v-if="currentScores.length" class="text-xs">
              now
              <template v-for="(s, i) in currentScores" :key="s.source"
                ><template v-if="i">, </template><SourceName :source="s.source" />
                {{ s.currentRating }}</template
              >
            </span>
          </div>

          <ul class="rounded-md border border-default divide-y divide-default">
            <li v-for="s in plan.steps" :key="s.source" class="flex items-start gap-3 px-3 py-2.5">
              <UCheckbox
                :model-value="picked.has(s.source)"
                :disabled="saving || !!outcomes[s.source]?.ok"
                class="mt-0.5"
                @update:model-value="toggle(s.source, $event)"
              />
              <div class="min-w-0 flex-1 text-sm">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <SourceName :source="s.source" class="font-medium" />
                  <span v-if="s.title !== title" class="truncate text-muted">{{ s.title }}</span>
                </div>
                <div class="text-muted">
                  {{ s.summary }}
                </div>
                <div v-if="s.source === 'mal'" class="text-xs text-dimmed">
                  Start and finish date today, unless MAL has them
                </div>
                <div v-if="outcomes[s.source] && !outcomes[s.source]!.ok" class="text-error">
                  {{ outcomes[s.source]!.error }}
                </div>
                <div v-if="outcomes[s.source]?.ratingError" class="text-error">
                  Marked, but the rating failed: {{ outcomes[s.source]!.ratingError }}
                </div>
              </div>
              <span
                v-if="outcomes[s.source]?.ok"
                class="flex shrink-0 items-center gap-1 text-sm text-success"
              >
                <UIcon name="i-lucide-check" class="size-4" />
                done
              </span>
            </li>
            <li v-for="s in plan.skipped" :key="s.source" class="px-3 py-2 text-sm text-muted">
              <SourceName :source="s.source" />: {{ s.reason }}
            </li>
          </ul>
          <p v-if="!plan.steps.length" class="text-sm text-muted">
            Nothing to mark: every source has it watched or set aside.
          </p>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2">
        <UButton
          v-if="plan?.steps.length && !allDone"
          :label="
            anyFailed
              ? 'Retry'
              : `Mark on ${pending.length} ${pending.length === 1 ? 'source' : 'sources'}`
          "
          :icon="anyFailed ? 'i-lucide-refresh-cw' : 'i-lucide-check-check'"
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
