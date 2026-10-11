<script setup lang="ts">
// Add a movie to your watchlists (#17): find it on TMDB (any movie) or AniList (anime movies), see what each source
// would do, then confirm (decision #3). A source that already lists the movie, or has it watched, is skipped and
// never moved. For an anime movie no list ties to Trakt, you can pick its Trakt movie among real search results.
type Source = "trakt" | "simkl" | "mal";
type From = "tmdb" | "anilist";
interface Result {
  id: number;
  title: string;
  year: number | null;
  detail: string | null;
  poster: string | null;
  url: string;
  listedOn: Source[];
}
interface Plan {
  title: string;
  year: number | null;
  anime: boolean;
  steps: { source: Source; summary: string; expected: string }[];
  skipped: { source: Source; reason: string }[];
  traktSearch: boolean;
}
interface TraktCandidate {
  id: number;
  title: string;
  year: number | null;
  url: string;
  onList: boolean;
}
interface Outcome {
  source: Source;
  ok: boolean;
  error?: string;
}

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ added: [] }>();

const from = ref<From>("tmdb");
const FROM_ITEMS = [
  { label: "Any movie", value: "tmdb" as const, icon: "i-lucide-clapperboard" },
  { label: "Anime movie", value: "anilist" as const, icon: "i-lucide-sparkles" },
];
const query = ref("");
const results = ref<Result[] | null>(null);
const searching = ref(false);
const error = ref<string | null>(null);

const picked = ref<Result | null>(null);
const traktId = ref<number | null>(null);
const plan = ref<Plan | null>(null);
const planning = ref(false);
const chosen = ref<Set<Source>>(new Set());
const outcomes = ref<Partial<Record<Source, Outcome>>>({});
const saving = ref(false);

// Trakt movie for an anime movie (optional).
const traktQuery = ref("");
const traktResults = ref<TraktCandidate[] | null>(null);
const traktSearching = ref(false);

const errorText = (e: unknown) =>
  (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message;

watch(open, (o) => {
  if (!o) return;
  results.value = null;
  picked.value = null;
  plan.value = null;
  error.value = null;
});
watch(from, () => {
  results.value = null;
  if (query.value.trim().length >= 2) search();
});

async function search() {
  if (query.value.trim().length < 2) return;
  searching.value = true;
  error.value = null;
  try {
    results.value = await $fetch<Result[]>("/api/movies/search", {
      query: { from: from.value, q: query.value.trim() },
    });
  } catch (e) {
    error.value = errorText(e);
  } finally {
    searching.value = false;
  }
}

async function preview() {
  if (!picked.value) return;
  planning.value = true;
  error.value = null;
  outcomes.value = {};
  try {
    plan.value = await $fetch<Plan>("/api/movies/add/preview", {
      method: "POST",
      body: { from: from.value, id: picked.value.id, traktId: traktId.value ?? undefined },
    });
    chosen.value = new Set(plan.value.steps.map((s) => s.source));
    if (plan.value.traktSearch && !traktResults.value) {
      traktQuery.value = plan.value.title;
      searchTrakt();
    }
  } catch (e) {
    plan.value = null;
    error.value = errorText(e);
  } finally {
    planning.value = false;
  }
}

function pick(r: Result) {
  picked.value = r;
  traktId.value = null;
  traktResults.value = null;
  preview();
}
function back() {
  picked.value = null;
  plan.value = null;
  error.value = null;
}

async function searchTrakt() {
  if (traktQuery.value.trim().length < 2) return;
  traktSearching.value = true;
  try {
    traktResults.value = await $fetch<TraktCandidate[]>("/api/movies/link-search", {
      query: {
        target: "trakt",
        q: traktQuery.value.trim(),
        year: plan.value?.year ?? undefined,
      },
    });
  } catch (e) {
    error.value = errorText(e);
  } finally {
    traktSearching.value = false;
  }
}
function pickTrakt(c: TraktCandidate) {
  traktId.value = c.id;
  traktResults.value = null;
  preview();
}

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

async function confirm() {
  if (!picked.value || !pending.value.length) return;
  saving.value = true;
  try {
    const res = await $fetch<{ outcomes: Outcome[] }>("/api/movies/add/confirm", {
      method: "POST",
      body: {
        from: from.value,
        id: picked.value.id,
        traktId: traktId.value ?? undefined,
        steps: pending.value.map((s) => ({ source: s.source })),
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
  <UModal v-model:open="open" title="Add a movie">
    <template #body>
      <div class="space-y-3">
        <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />

        <!-- Find it. -->
        <template v-if="!picked">
          <UTabs v-model="from" :items="FROM_ITEMS" :content="false" size="sm" />
          <p class="text-xs text-muted">
            <template v-if="from === 'tmdb'">Any movie, from TMDB.</template>
            <template v-else
              >Anime movies, from <SourceName source="anilist" />; they can go on
              <SourceName source="mal" /> too.</template
            >
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
            <li v-for="r in results" :key="r.id" class="flex items-center gap-3 px-3 py-2">
              <img
                v-if="r.poster"
                :src="r.poster"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                class="h-15 w-10 shrink-0 rounded object-cover bg-elevated"
              />
              <div v-else class="h-15 w-10 shrink-0 rounded bg-elevated" />
              <div class="min-w-0 flex-1">
                <ULink
                  :to="r.url"
                  target="_blank"
                  external
                  class="font-medium underline decoration-dotted underline-offset-2"
                >
                  {{ r.title }}
                </ULink>
                <div class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span v-if="r.year">{{ r.year }}</span>
                  <span v-if="r.detail">{{ r.detail }}</span>
                  <span v-if="r.listedOn.length" class="inline-flex items-center gap-1">
                    on
                    <SourceIcon
                      v-for="s in r.listedOn"
                      :key="s"
                      :source="s"
                      :title="SOURCE_LABELS[s]"
                    />
                  </span>
                </div>
              </div>
              <UButton label="Pick" size="xs" variant="soft" @click="pick(r)" />
            </li>
            <li v-if="!results.length" class="px-3 py-2 text-sm text-muted">Nothing found.</li>
          </ul>
        </template>

        <!-- What each source would do. -->
        <template v-else>
          <UButton
            label="Back to the results"
            icon="i-lucide-arrow-left"
            variant="link"
            color="neutral"
            size="xs"
            class="p-0"
            @click="back"
          />
          <div v-if="planning" class="text-sm text-muted">Loading…</div>
          <template v-else-if="plan">
            <div>
              <div class="text-lg font-semibold text-highlighted">{{ plan.title }}</div>
              <div class="text-sm text-muted">
                {{ [plan.year, plan.anime ? "Anime" : null].filter(Boolean).join(" · ") }}
              </div>
            </div>
            <ul class="rounded-md border border-default divide-y divide-default">
              <li
                v-for="s in plan.steps"
                :key="s.source"
                class="flex items-start gap-3 px-3 py-2.5"
              >
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
            </ul>

            <!-- An anime movie Trakt cannot be told: pick its Trakt movie, or leave Trakt out. -->
            <div v-if="plan.traktSearch" class="space-y-2">
              <p class="text-sm text-muted">
                Which <SourceName source="trakt" /> movie is it? Optional; it is also kept as a
                link.
              </p>
              <form class="flex gap-2" @submit.prevent="searchTrakt">
                <UInput
                  v-model="traktQuery"
                  icon="i-lucide-search"
                  class="flex-1"
                  aria-label="Search Trakt"
                />
                <UButton
                  type="submit"
                  label="Search"
                  color="neutral"
                  variant="outline"
                  :loading="traktSearching"
                />
              </form>
              <ul
                v-if="traktResults"
                class="max-h-60 overflow-y-auto rounded-md border border-default divide-y divide-default"
              >
                <li v-for="c in traktResults" :key="c.id" class="flex items-center gap-3 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <ULink
                      :to="c.url"
                      target="_blank"
                      external
                      class="font-medium underline decoration-dotted underline-offset-2"
                    >
                      {{ c.title }}
                    </ULink>
                    <span v-if="c.year" class="ms-2 text-xs text-muted">{{ c.year }}</span>
                  </div>
                  <UButton label="Pick" size="xs" variant="soft" @click="pickTrakt(c)" />
                </li>
                <li v-if="!traktResults.length" class="px-3 py-2 text-sm text-muted">
                  Nothing found.
                </li>
              </ul>
            </div>
          </template>
        </template>
      </div>
    </template>

    <template v-if="picked && plan" #footer>
      <div class="flex gap-2">
        <UButton
          v-if="plan.steps.length && !allDone"
          :label="
            anyFailed
              ? 'Retry'
              : `Add on ${pending.length} ${pending.length === 1 ? 'source' : 'sources'}`
          "
          :icon="anyFailed ? 'i-lucide-refresh-cw' : 'i-lucide-plus'"
          :disabled="planning || !pending.length"
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
