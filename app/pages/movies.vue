<script setup lang="ts">
import { itemUrl } from "#shared/utils/source-links";

// Movies (#17, decision #25): what is on each source's movie lists, one row per movie, each source with its own
// title and state. Differences are shown, never resolved (decision #2). A movie watched or set aside on every
// source drops off. "Mark watched" on each card is previewed per source before anything is written. Cards in the
// Poster backdrop look of the Shows cards.
useSeoMeta({ title: "Movies · Tsuzuku" });

const COLUMNS = ["trakt", "simkl", "mal"] as const;
type Column = (typeof COLUMNS)[number];

type Movies = Awaited<ReturnType<typeof $fetch<unknown, "/api/movies">>>;
type Row = Movies["rows"][number];
type Cell = Row["cells"][Column];

// Kept for the session like Shows: the last list stays on screen while the next one loads.
const data = useState<Movies | undefined>("movies:last", () => undefined);
const { refresh, status, error } = useFetch("/api/movies", {
  lazy: true,
  onResponse({ response }) {
    if (response.ok) data.value = response._data;
  },
});
const loading = computed(() => status.value === "pending");

const rows = computed(() => data.value?.rows ?? []);
const differing = computed(() => rows.value.filter((r) => r.differs).length);
const onlyDiffering = ref(false);
const shown = computed(() =>
  onlyDiffering.value ? rows.value.filter((r) => r.differs) : rows.value,
);

const warnings = computed(() =>
  Object.entries(data.value?.sources ?? {})
    .filter(([, s]) => s.status !== "ok")
    .map(([source, s]) => ({
      source,
      text:
        s.status === "rate_limited"
          ? `rate limited${s.retryAfter ? `, try again in ${s.retryAfter} s` : ""}`
          : (s.error ?? s.status),
      stale: s.stale,
    })),
);

// Each source's own word for where the movie is.
const STATE_LABELS: Record<string, string> = {
  watchlist: "Watchlist",
  plantowatch: "Plan to Watch",
  plan_to_watch: "Plan to Watch",
  watching: "Watching",
  watched: "Watched",
  completed: "Completed",
  dropped: "Dropped",
  hold: "On Hold",
  on_hold: "On Hold",
};
const stateLabel = (c: Cell) =>
  c.entry ? (STATE_LABELS[c.entry.listStatus] ?? c.entry.listStatus) : "";
const stateColor = (c: Cell) => {
  switch (c.entry?.state) {
    case "watchlist":
    case "watching":
      return "primary" as const;
    case "watched":
      return "success" as const;
    default:
      return "neutral" as const;
  }
};
const absentLabel = (c: Cell) =>
  c.absent === "not_listed" ? "not on your lists" : c.absent === "not_linked" ? "not linked" : "";

const linkOf = (c: Cell) =>
  c.entry
    ? itemUrl({ source: c.entry.source, kind: c.entry.anime ? "anime" : "movie", ids: c.entry.ids })
    : null;

// Images that failed to load, so the next candidate is tried (a source's image server can refuse).
const failed = reactive(new Set<string>());

const markOpen = ref(false);
const markTarget = ref<{ key: string; title: string } | null>(null);
function mark(row: Row) {
  markTarget.value = { key: row.key, title: row.title };
  markOpen.value = true;
}
const imageFor = (images: string[]) => images.find((u) => !failed.has(u)) ?? null;
const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;
</script>

<template>
  <UContainer class="py-4 sm:py-8">
    <UPageHeader
      title="Movies"
      description="Your movie watchlists on each source, side by side. Watched everywhere drops off."
      :ui="{ wrapper: '@container flex-row flex-wrap items-center justify-between gap-y-3' }"
    >
      <template #links>
        <UButton
          aria-label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="loading"
          @click="refresh()"
        >
          <span class="hidden @[26rem]:inline">Refresh</span>
        </UButton>
      </template>
    </UPageHeader>

    <UPageBody>
      <UAlert
        v-if="error && !data"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="`Could not load movies: ${error.statusMessage ?? error.message}`"
      />
      <UAlert
        v-for="w in warnings"
        :key="w.source"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
      >
        <template #title>
          <SourceName :source="w.source" /> {{ w.text
          }}{{ w.stale ? " · showing what it said last" : "" }}
        </template>
      </UAlert>
      <UAlert
        v-if="data?.errors.length"
        color="warning"
        icon="i-lucide-circle-alert"
        title="Some list items could not be read"
        :description="data.errors.map((e) => `${SOURCE_LABELS[e.source]}: ${e.error}`).join(' · ')"
      />

      <div v-if="data" class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <span>{{ rows.length }} {{ rows.length === 1 ? "movie" : "movies" }} to watch</span>
        <USwitch
          v-if="differing"
          v-model="onlyDiffering"
          :label="`Only where sources differ (${differing})`"
        />
      </div>

      <div v-if="!data && loading" class="text-sm text-muted">Loading…</div>
      <p v-else-if="data && !rows.length" class="text-sm text-muted">
        Nothing on your movie watchlists.
      </p>

      <!-- Cards in the Poster backdrop look of the Shows cards: the poster blurred behind, a big title, then one short
           line per source. A source's own title shows only where it differs from the card's (decision #19). -->
      <div class="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <article
          v-for="row in shown"
          :key="row.key"
          class="relative overflow-hidden rounded-xl border border-default border-s-4 p-3 sm:p-4"
          :class="row.differs ? 'border-s-warning' : 'border-s-default'"
        >
          <ClientOnly v-if="imageFor(row.images)">
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-0 overflow-hidden [contain:paint]"
            >
              <img
                :src="imageFor(row.images)!"
                alt=""
                referrerpolicy="no-referrer"
                class="absolute -top-[10%] -left-[10%] h-[30%] w-[30%] origin-top-left scale-400 object-cover opacity-50 blur-md saturate-150"
              />
              <div
                class="absolute inset-0 bg-linear-to-r from-(--ui-bg) via-(--ui-bg)/75 to-(--ui-bg)/35"
              />
            </div>
          </ClientOnly>

          <div class="relative flex gap-3 sm:gap-4">
            <ClientOnly>
              <img
                v-if="imageFor(row.images)"
                :src="imageFor(row.images)!"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                class="h-30 w-20 shrink-0 rounded object-cover bg-elevated sm:h-36 sm:w-24"
                @error="failed.add(imageFor(row.images)!)"
              />
              <div v-else class="h-30 w-20 shrink-0 rounded bg-elevated sm:h-36 sm:w-24" />
              <template #fallback>
                <div class="h-30 w-20 shrink-0 rounded bg-elevated sm:h-36 sm:w-24" />
              </template>
            </ClientOnly>

            <div class="min-w-0 flex-1 space-y-2">
              <div>
                <h3
                  class="text-xl font-extrabold leading-tight tracking-tight text-highlighted line-clamp-2 break-words"
                >
                  {{ row.title }}
                </h3>
                <div class="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                  <span v-if="row.year">{{ row.year }}</span>
                  <UBadge
                    v-if="row.anime"
                    label="Anime"
                    color="neutral"
                    variant="outline"
                    size="sm"
                  />
                  <UBadge
                    v-if="row.differs"
                    label="differs"
                    color="warning"
                    variant="subtle"
                    size="sm"
                  />
                </div>
              </div>

              <ul class="space-y-1 text-sm">
                <template v-for="source in COLUMNS" :key="source">
                  <li
                    v-if="row.cells[source].absent !== 'not_anime'"
                    class="flex min-w-0 items-center gap-1.5"
                  >
                    <SourceIcon :source="source" :title="SOURCE_LABELS[source]" />
                    <template v-if="row.cells[source].entry">
                      <component
                        :is="linkOf(row.cells[source]) ? 'a' : 'span'"
                        :href="linkOf(row.cells[source]) ?? undefined"
                        target="_blank"
                        rel="noopener"
                        :title="`${row.cells[source].entry!.title} on ${SOURCE_LABELS[source]}`"
                        class="flex min-w-0 items-center gap-1.5"
                      >
                        <UBadge
                          :label="stateLabel(row.cells[source])"
                          :color="stateColor(row.cells[source])"
                          variant="subtle"
                          size="sm"
                          class="shrink-0"
                        />
                        <span
                          v-if="row.cells[source].entry!.title !== row.title"
                          class="truncate text-muted underline decoration-dotted underline-offset-2"
                          >{{ row.cells[source].entry!.title }}</span
                        >
                        <UIcon
                          v-else
                          name="i-lucide-external-link"
                          class="size-3.5 shrink-0 text-dimmed"
                        />
                      </component>
                      <span
                        v-if="row.cells[source].entry!.watchedBefore"
                        class="shrink-0 text-xs text-muted"
                        >watched before</span
                      >
                      <span
                        v-else-if="row.cells[source].entry!.state === 'watched'"
                        class="shrink-0 text-xs text-muted"
                        >{{ date(row.cells[source].entry!.watchedAt) ?? "" }}</span
                      >
                    </template>
                    <span v-else class="text-xs text-dimmed">{{
                      absentLabel(row.cells[source])
                    }}</span>
                  </li>
                </template>
              </ul>
            </div>
            <!-- Mark watched: a round icon button like on Shows, at the card's bottom right. -->
            <UButton
              class="self-end rounded-full p-2"
              :ui="{ leadingIcon: 'size-6' }"
              icon="i-lucide-check-check"
              title="Mark watched"
              aria-label="Mark watched"
              variant="solid"
              size="sm"
              @click="mark(row)"
            />
          </div>
        </article>
      </div>

      <MovieMarkModal
        v-if="markTarget"
        v-model:open="markOpen"
        :row-key="markTarget.key"
        :title="markTarget.title"
        @marked="refresh()"
      />
    </UPageBody>
  </UContainer>
</template>
