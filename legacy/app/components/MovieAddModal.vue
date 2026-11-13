<script setup lang="ts">
// Add a movie to your watchlists (#17): find it on TMDB (any movie) or AniList (anime movies), see what each source
// would do, then confirm (decision #3). A source that already lists the movie, or has it watched, is skipped and
// never moved. Where none of your lists ties the movie to Trakt or MAL, you can pick it there among real search
// results; the pick is kept as a link.
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
  malSearch: boolean;
}
interface Candidate {
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

// `rowKey`: a movie already on the page, to add where it is missing (after a link, or from the card's menu); the
// modal opens on its preview, with no search.
const props = defineProps<{ rowKey?: string; title?: string }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ added: [] }>();
// What the preview and the confirm are asked about: the row, or the picked search result.
const target = () =>
  props.rowKey ? { rowKey: props.rowKey } : { from: from.value, id: picked.value!.id };

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
const malId = ref<number | null>(null);
const plan = ref<Plan | null>(null);
const planning = ref(false);
const chosen = ref<Set<Source>>(new Set());
const outcomes = ref<Partial<Record<Source, Outcome>>>({});
const saving = ref(false);

// The Trakt movie or MAL entry for a movie none of your lists ties to that source (optional): picked among real
// search results, Trakt's movies or AniList's anime movies.
type Side = "trakt" | "mal";
const sides = reactive({
  trakt: { query: "", results: null as Candidate[] | null, searching: false, open: false },
  mal: { query: "", results: null as Candidate[] | null, searching: false, open: false },
});
// Titles to search with for a movie on the page: AniList's English title first for an anime movie.
const titles = ref<string[]>([]);

const errorText = (e: unknown) =>
  (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message;

watch(
  open,
  (o) => {
    if (!o) return;
    results.value = null;
    picked.value = null;
    plan.value = null;
    error.value = null;
    traktId.value = null;
    malId.value = null;
    for (const side of ["trakt", "mal"] as const)
      Object.assign(sides[side], { query: "", results: null, searching: false, open: false });
    titles.value = [];
    if (props.rowKey) {
      picked.value = {
        id: 0,
        title: props.title ?? "",
        year: null,
        detail: null,
        poster: null,
        url: "",
        listedOn: [],
      };
      preview();
    }
  },
  { immediate: true },
);
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
      body: { ...target(), traktId: traktId.value ?? undefined, malId: malId.value ?? undefined },
    });
    chosen.value = new Set(plan.value.steps.map((s) => s.source));
    if (props.rowKey && !titles.value.length) {
      titles.value = await $fetch<{ titles: string[] }>("/api/movies/link-titles", {
        query: { rowKey: props.rowKey },
      })
        .then((r) => r.titles)
        .catch(() => []);
    }
    // An anime movie Trakt cannot be told: its search opens at once. MAL's only on asking, unless it is anime.
    if (plan.value.traktSearch && !sides.trakt.results) openSide("trakt");
    if (plan.value.malSearch && plan.value.anime && !sides.mal.results) openSide("mal");
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
  malId.value = null;
  sides.trakt.results = null;
  sides.mal.results = null;
  preview();
}
function back() {
  picked.value = null;
  plan.value = null;
  error.value = null;
}

function openSide(side: Side) {
  sides[side].open = true;
  sides[side].query ||= titles.value[0] ?? plan.value?.title ?? "";
  searchSide(side);
}
async function searchSide(side: Side) {
  const q = sides[side].query.trim();
  if (q.length < 2) return;
  sides[side].searching = true;
  try {
    sides[side].results =
      side === "trakt"
        ? await $fetch<Candidate[]>("/api/movies/link-search", {
            query: { target: "trakt", q, year: plan.value?.year ?? undefined },
          })
        : (await $fetch<Result[]>("/api/movies/search", { query: { from: "anilist", q } })).map(
            (r) => ({ ...r, onList: r.listedOn.includes("mal") }),
          );
  } catch (e) {
    error.value = errorText(e);
  } finally {
    sides[side].searching = false;
  }
}
function pickSide(side: Side, c: Candidate) {
  if (side === "trakt") traktId.value = c.id;
  else malId.value = c.id;
  sides[side].results = null;
  sides[side].open = false;
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
        ...target(),
        traktId: traktId.value ?? undefined,
        malId: malId.value ?? undefined,
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
  <UModal
    v-model:open="open"
    :title="rowKey ? 'Add to the other watchlists' : 'Add a movie'"
    :description="rowKey ? title : undefined"
  >
    <template #body>
      <div class="space-y-3">
        <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />

        <!-- Find it. -->
        <template v-if="!picked">
          <UTabs v-model="from" :items="FROM_ITEMS" :content="false" size="sm" />
          <p class="text-xs text-muted">
            <template v-if="from === 'tmdb'"
              >Any movie, from <SourceName source="tmdb" />.</template
            >
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
            v-if="!rowKey"
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

            <p
              v-if="!plan.steps.length && !plan.traktSearch && !plan.malSearch"
              class="text-sm text-muted"
            >
              Every source already has it.
            </p>

            <!-- The Trakt movie or MAL entry, where none of your lists ties it to that source. -->
            <template v-for="side in ['trakt', 'mal'] as const" :key="side">
              <div v-if="side === 'trakt' ? plan.traktSearch : plan.malSearch" class="space-y-2">
                <p v-if="!sides[side].open" class="text-sm text-muted">
                  <template v-if="side === 'mal'">An anime movie?</template>
                  <UButton
                    :label="`Find it on ${side === 'trakt' ? 'Trakt' : 'MAL'}`"
                    variant="link"
                    size="sm"
                    class="p-0"
                    @click="openSide(side)"
                  />
                </p>
                <template v-else>
                  <p class="text-sm text-muted">
                    Which <SourceName :source="side" />
                    {{ side === "trakt" ? "movie" : "entry" }} is it? Optional; it keeps the sources
                    on one card.
                  </p>
                  <div v-if="titles.length > 1" class="flex flex-wrap gap-1">
                    <UButton
                      v-for="t in titles"
                      :key="t"
                      :label="t"
                      size="xs"
                      color="neutral"
                      :variant="t === sides[side].query ? 'soft' : 'ghost'"
                      @click="
                        sides[side].query = t;
                        searchSide(side);
                      "
                    />
                  </div>
                  <form class="flex gap-2" @submit.prevent="searchSide(side)">
                    <UInput
                      v-model="sides[side].query"
                      icon="i-lucide-search"
                      class="flex-1"
                      :aria-label="`Search ${side === 'trakt' ? 'Trakt' : 'AniList'}`"
                    />
                    <UButton
                      type="submit"
                      label="Search"
                      color="neutral"
                      variant="outline"
                      :loading="sides[side].searching"
                    />
                  </form>
                  <ul
                    v-if="sides[side].results"
                    class="max-h-60 overflow-y-auto rounded-md border border-default divide-y divide-default"
                  >
                    <li
                      v-for="c in sides[side].results"
                      :key="c.id"
                      class="flex items-center gap-3 px-3 py-2"
                    >
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
                        <UBadge
                          v-if="c.onList"
                          label="on your list"
                          color="primary"
                          variant="subtle"
                          size="sm"
                          class="ms-2"
                        />
                      </div>
                      <UButton label="Pick" size="xs" variant="soft" @click="pickSide(side, c)" />
                    </li>
                    <li v-if="!sides[side].results!.length" class="px-3 py-2 text-sm text-muted">
                      Nothing found.
                    </li>
                  </ul>
                </template>
              </div>
            </template>
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
