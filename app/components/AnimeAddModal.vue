<script setup lang="ts">
// Add an anime on Shows: find it on AniList, choose Watching or Plan to Watch, preview what MAL and Simkl would do,
// then confirm per source (decision #3). Nothing is written before the confirm. Trakt is not offered: an AniList
// pick carries no Trakt ID; Trakt's show gets linked through Mappings once it is there.
type Source = "simkl" | "mal";
type Status = "watching" | "plan_to_watch";
interface Target {
  malId: number;
  title: string;
  format: string | null;
  episodes: number | null;
  status: string | null;
  year: number | null;
  cover: string | null;
}
interface Plan {
  target: Target | null;
  steps: { source: Source; summary: string; expected: string }[];
  skipped: { source: Source; reason: string }[];
}
interface Outcome {
  source: Source;
  ok: boolean;
  error?: string;
}

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ added: [] }>();

const STATUS_ITEMS = [
  { label: "Watching", value: "watching" as const, icon: "i-lucide-play" },
  { label: "Plan to Watch", value: "plan_to_watch" as const, icon: "i-lucide-bookmark" },
];
const status = ref<Status>("watching");

const query = ref("");
const results = ref<Target[] | null>(null);
const searching = ref(false);
const moviesLeftOut = ref(0);
const error = ref<string | null>(null);

const picked = ref<Target | null>(null);
const plan = ref<Plan | null>(null);
const loading = ref(false);
const chosen = ref<Set<Source>>(new Set());
const outcomes = ref<Partial<Record<Source, Outcome>>>({});
const saving = ref(false);

const errorText = (e: unknown) =>
  (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message;
const malUrl = (id: number) => `https://myanimelist.net/anime/${id}`;
const describe = (t: Target) =>
  [
    t.format,
    t.episodes ? `${t.episodes} eps` : null,
    t.year,
    t.status?.toLowerCase().replace(/_/g, " "),
  ]
    .filter(Boolean)
    .join(" · ");

// Opening again starts from the search.
watch(open, (o) => {
  if (!o) return;
  picked.value = null;
  plan.value = null;
  outcomes.value = {};
  error.value = null;
});

async function search() {
  if (query.value.trim().length < 2) return;
  searching.value = true;
  error.value = null;
  try {
    // Anime movies are on Movies (decision #23), so they are left out here.
    const all = await $fetch<Target[]>("/api/anilist/search", { query: { q: query.value.trim() } });
    results.value = all.filter((r) => r.format !== "MOVIE");
    moviesLeftOut.value = all.length - results.value.length;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    searching.value = false;
  }
}

async function preview() {
  if (!picked.value) return;
  loading.value = true;
  error.value = null;
  outcomes.value = {};
  try {
    plan.value = await $fetch<Plan>("/api/anime/add/preview", {
      method: "POST",
      body: { malId: picked.value.malId, status: status.value },
    });
    chosen.value = new Set(plan.value.steps.map((s) => s.source));
  } catch (e) {
    plan.value = null;
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}

function pick(t: Target) {
  picked.value = t;
  void preview();
}
// The list changes what each source would do, so the preview is read again.
watch(status, () => {
  if (picked.value) void preview();
});

function toggle(source: Source, on: boolean | "indeterminate") {
  const next = new Set(chosen.value);
  if (on === true) next.add(source);
  else next.delete(source);
  chosen.value = next;
}

const pending = computed(() =>
  (plan.value?.steps ?? []).filter(
    (s) => chosen.value.has(s.source) && !outcomes.value[s.source]?.ok,
  ),
);
const anyFailed = computed(() => Object.values(outcomes.value).some((o) => o && !o.ok));
const allDone = computed(
  () => !!plan.value && Object.keys(outcomes.value).length > 0 && !pending.value.length,
);
const listLabel = computed(() => (status.value === "watching" ? "Watching" : "Plan to Watch"));

async function confirm() {
  if (!picked.value || !pending.value.length) return;
  saving.value = true;
  try {
    const res = await $fetch<{ outcomes: Outcome[] }>("/api/anime/add/confirm", {
      method: "POST",
      body: {
        malId: picked.value.malId,
        status: status.value,
        steps: pending.value.map((s) => ({ source: s.source, expected: s.expected })),
      },
    });
    outcomes.value = {
      ...outcomes.value,
      ...Object.fromEntries(res.outcomes.map((o) => [o.source, o])),
    };
    if (res.outcomes.some((o) => o.ok)) emit("added");
    if (res.outcomes.every((o) => o.ok)) open.value = false;
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
  <UModal v-model:open="open" title="Add an anime">
    <template #body>
      <div class="space-y-3">
        <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />

        <UTabs
          v-model="status"
          :items="STATUS_ITEMS"
          :content="false"
          size="sm"
          :disabled="saving || allDone"
        />

        <!-- Find it. -->
        <template v-if="!picked">
          <p class="text-xs text-muted">
            From <SourceName source="anilist" />; it goes on <SourceName source="mal" /> and
            <SourceName source="simkl" />.
          </p>
          <form class="flex gap-2" @submit.prevent="search">
            <UInput
              v-model="query"
              icon="i-lucide-search"
              class="flex-1"
              placeholder="Title"
              aria-label="Title"
              autofocus
            />
            <UButton
              type="submit"
              label="Search"
              color="neutral"
              variant="outline"
              :loading="searching"
            />
          </form>
          <ul
            v-if="results"
            class="max-h-96 overflow-y-auto rounded-md border border-default divide-y divide-default"
          >
            <li v-for="r in results" :key="r.malId" class="flex items-center gap-3 px-3 py-2">
              <img
                v-if="r.cover"
                :src="r.cover"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                class="h-15 w-10 shrink-0 rounded object-cover bg-elevated"
              />
              <div v-else class="h-15 w-10 shrink-0 rounded bg-elevated" />
              <div class="min-w-0 flex-1">
                <ULink
                  :to="malUrl(r.malId)"
                  target="_blank"
                  external
                  class="font-medium underline decoration-dotted underline-offset-2"
                >
                  {{ r.title }}
                </ULink>
                <div class="text-xs text-muted">{{ describe(r) }}</div>
              </div>
              <UButton label="Pick" size="xs" variant="soft" @click="pick(r)" />
            </li>
            <li v-if="!results.length" class="px-3 py-2 text-sm text-muted">No anime found.</li>
          </ul>
          <p v-if="moviesLeftOut" class="text-xs text-muted">
            {{ moviesLeftOut }} anime {{ moviesLeftOut === 1 ? "movie" : "movies" }} left out: add
            those on <ULink to="/movies" class="underline">Movies</ULink>.
          </p>
        </template>

        <!-- The pick and each source's step. -->
        <template v-else>
          <div class="flex items-start gap-3">
            <img
              v-if="picked.cover"
              :src="picked.cover"
              alt=""
              referrerpolicy="no-referrer"
              class="h-21 w-14 shrink-0 rounded object-cover bg-elevated"
            />
            <div class="min-w-0 flex-1">
              <ULink
                :to="malUrl(picked.malId)"
                target="_blank"
                external
                class="text-lg font-semibold text-highlighted leading-snug underline decoration-dotted underline-offset-4"
              >
                {{ picked.title }}
              </ULink>
              <div class="text-sm text-muted">{{ describe(picked) }}</div>
              <UButton
                v-if="!saving && !allDone"
                label="Not this one? Search again"
                variant="link"
                size="xs"
                class="p-0"
                @click="
                  picked = null;
                  plan = null;
                "
              />
            </div>
          </div>

          <div v-if="loading" class="text-sm text-muted">Loading…</div>
          <ul v-else-if="plan" class="rounded-md border border-default divide-y divide-default">
            <li v-for="s in plan.steps" :key="s.source" class="flex items-start gap-3 px-3 py-2.5">
              <UCheckbox
                :model-value="chosen.has(s.source)"
                :disabled="saving || !!outcomes[s.source]?.ok"
                class="mt-0.5"
                @update:model-value="toggle(s.source, $event)"
              />
              <div class="min-w-0 flex-1 text-sm">
                <SourceName :source="s.source" class="font-medium" />
                <div class="text-muted">{{ s.summary }}</div>
                <div v-if="outcomes[s.source] && !outcomes[s.source]!.ok" class="text-error">
                  {{ outcomes[s.source]!.error }}
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
            <li class="px-3 py-2 text-sm text-muted">
              <SourceName source="trakt" />: not offered; link its show on Mappings once it is
              there.
            </li>
          </ul>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2">
        <UButton
          v-if="plan && !allDone"
          :label="
            anyFailed
              ? 'Retry'
              : `Add to ${listLabel} on ${pending.length} ${pending.length === 1 ? 'source' : 'sources'}`
          "
          :icon="anyFailed ? 'i-lucide-refresh-cw' : 'i-lucide-plus'"
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
