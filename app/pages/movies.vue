<script setup lang="ts">
import { itemUrl } from "#shared/utils/source-links";

// Movies (#17, decision #25): what is on each source's movie lists, one row per movie, each source with its own
// title and state. Differences are shown, never resolved (decision #2). A movie watched or set aside on every
// source drops off. Read-only for now.
useSeoMeta({ title: "Movies · Tsuzuku" });

const COLUMNS = ["trakt", "simkl", "mal"] as const;
type Column = (typeof COLUMNS)[number];

type Movies = Awaited<ReturnType<typeof $fetch<unknown, "/api/movies">>>;
type Row = Movies["rows"][number];
type Cell = Row["cells"][Column];

// Kept for the session like Progress: the last list stays on screen while the next one loads.
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
const absentLabel = (c: Cell, source: Column) =>
  c.absent === "not_listed"
    ? `Not on your ${SOURCE_LABELS[source]} lists`
    : c.absent === "not_linked"
      ? "Not linked"
      : "";

const linkOf = (c: Cell, row: Row) =>
  c.entry
    ? itemUrl({
        source: c.entry.source,
        kind:
          c.entry.source === "mal" || (c.entry.source === "simkl" && row.anime) ? "anime" : "movie",
        ids: c.entry.ids,
      })
    : null;
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

      <ul class="space-y-3">
        <li
          v-for="row in shown"
          :key="row.key"
          class="flex gap-3 rounded-lg border p-3"
          :class="row.differs ? 'border-warning/50' : 'border-default'"
        >
          <img
            v-if="row.images[0]"
            :src="row.images[0]"
            alt=""
            loading="lazy"
            class="h-24 w-16 shrink-0 rounded object-cover bg-elevated"
          />
          <div v-else class="h-24 w-16 shrink-0 rounded bg-elevated" aria-hidden="true" />

          <div class="min-w-0 flex-1 space-y-2">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="font-semibold text-highlighted">{{ row.title }}</span>
              <span v-if="row.year" class="text-sm text-muted">{{ row.year }}</span>
              <UBadge v-if="row.anime" label="Anime" color="neutral" variant="subtle" size="sm" />
              <UBadge
                v-if="row.differs"
                label="Differs"
                color="warning"
                variant="subtle"
                size="sm"
                icon="i-lucide-triangle-alert"
              />
            </div>

            <!-- One line per source, each with its own title and state (decision #19). -->
            <ul class="grid gap-1.5 text-sm sm:grid-cols-3 sm:gap-3">
              <template v-for="source in COLUMNS" :key="source">
                <li v-if="row.cells[source].absent !== 'not_anime'" class="min-w-0">
                  <div class="flex items-center gap-2">
                    <SourceName :source="source" class="text-muted" />
                    <UBadge
                      v-if="row.cells[source].entry"
                      :label="stateLabel(row.cells[source])"
                      :color="stateColor(row.cells[source])"
                      variant="subtle"
                      size="sm"
                    />
                    <span v-else class="text-xs text-dimmed">{{
                      absentLabel(row.cells[source], source)
                    }}</span>
                  </div>
                  <template v-if="row.cells[source].entry">
                    <component
                      :is="linkOf(row.cells[source], row) ? 'a' : 'span'"
                      :href="linkOf(row.cells[source], row) ?? undefined"
                      target="_blank"
                      rel="noopener"
                      class="block truncate underline decoration-dotted underline-offset-2"
                    >
                      {{ row.cells[source].entry!.title }}
                    </component>
                    <div v-if="row.cells[source].entry!.watchedBefore" class="text-xs text-muted">
                      Watched before{{
                        row.cells[source].entry!.watchedAt
                          ? ` (${date(row.cells[source].entry!.watchedAt)})`
                          : ""
                      }}
                    </div>
                    <div
                      v-else-if="row.cells[source].entry!.state === 'watched'"
                      class="text-xs text-muted"
                    >
                      {{ date(row.cells[source].entry!.watchedAt) ?? "" }}
                    </div>
                  </template>
                </li>
              </template>
            </ul>
          </div>
        </li>
      </ul>
    </UPageBody>
  </UContainer>
</template>
