<script setup lang="ts">
import { itemUrl } from "#shared/utils/source-links";

// Movies (#17, decision #25): what is on each source's movie lists, one row per movie, each source with its own
// title and state. Differences are shown, never resolved (decision #2). A movie watched or set aside on every
// source drops off. "Mark watched" on each card is previewed per source before anything is written. Cards in the
// Poster backdrop look of the Shows cards; a click shows each source's own view.
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

// A source without the movie, but known by an ID the row carries (from another source or your link): its page.
const absentUrl = (row: Row, source: Column) =>
  row.cells[source].absent === "not_listed"
    ? itemUrl({
        source,
        kind: source === "mal" || (source === "simkl" && row.anime) ? "anime" : "movie",
        ids: { traktSlug: row.ids.traktSlug, mal: row.ids.mal },
      })
    : null;

// Opened cards (MediaCard opens on a click or Enter / Space, as on Shows).
const open = reactive(new Set<string>());
const toggle = (key: string) => (open.has(key) ? open.delete(key) : open.add(key));

const toast = useToast();

// "Add to the other watchlists": a movie on the page, added where it is missing, after a preview (decision #3).
const fillOpen = ref(false);
const fillTarget = ref<{ key: string; title: string } | null>(null);
function fill(row: { key: string; title: string }) {
  fillTarget.value = { key: row.key, title: row.title };
  fillOpen.value = true;
}
// A source without a movie you have to watch elsewhere: worth offering. A source nothing ties it to counts too:
// the preview lets you pick the movie there.
const fillable = (row: Row) =>
  COLUMNS.some((s) => ["not_listed", "not_linked"].includes(row.cells[s].absent ?? "")) &&
  COLUMNS.some((s) => ["watchlist", "watching"].includes(row.cells[s].entry?.state ?? ""));
async function unlink(id: number) {
  try {
    await $fetch(`/api/movies/links/${id}`, { method: "DELETE" });
    await refresh();
  } catch (e) {
    toast.add({
      title: "Could not remove the link",
      description: (e as Error).message,
      color: "error",
    });
  }
}
// The card's menu: add it where it is missing; undo a link kept from a pick (a wrong pick, say).
const menu = (row: Row) =>
  [
    fillable(row)
      ? [
          {
            label: "Add to the other watchlists",
            icon: "i-lucide-list-plus",
            onSelect: () => fill(row),
          },
        ]
      : [],
    row.links.map((id) => ({
      label: "Remove your link",
      icon: "i-lucide-unlink",
      color: "error" as const,
      onSelect: () => unlink(id),
    })),
  ].filter((group) => group.length);

const addOpen = ref(false);
const markOpen = ref(false);
const markTarget = ref<{ key: string; title: string } | null>(null);
function mark(row: Row) {
  markTarget.value = { key: row.key, title: row.title };
  markOpen.value = true;
}
const { imageFor } = usePosterImage();
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
        <div class="flex items-center gap-2">
          <UButton aria-label="Add a movie" icon="i-lucide-plus" @click="addOpen = true">
            <span class="hidden @[26rem]:inline">Add</span>
          </UButton>
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
        </div>
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

      <div v-if="!data && loading" class="text-sm text-muted">Loading…</div>
      <p v-else-if="data && !rows.length" class="text-sm text-muted">
        Nothing on your movie watchlists.
      </p>

      <!-- Cards in the Poster backdrop look of the Shows cards: the poster behind (PosterBackdrop), a big title, the year and
           flags. A click opens each source's own view underneath, as on Shows: its state, its own title where it
           differs from the card's (decision #19), and its page. -->
      <MasonryGrid
        v-slot="{ item: row }"
        :items="rows"
        :item-key="(r) => r.key"
        :columns="{ md: 2, '2xl': 3 }"
      >
        <MediaCard
          class="overflow-hidden rounded-xl p-3 sm:p-4"
          :edge="row.differs ? 'warning' : 'default'"
          :backdrop="imageFor(row.images)"
          openable
          :open="open.has(row.key)"
          @toggle="toggle(row.key)"
        >
          <div class="relative flex gap-3 sm:gap-4">
            <MediaPoster :images="row.images" />

            <div class="min-w-0 flex-1">
              <h3
                class="text-xl font-extrabold leading-tight tracking-tight text-highlighted break-words"
              >
                {{ row.title }}
              </h3>
              <p v-if="row.altTitle" class="mt-0.5 text-sm leading-snug text-muted break-words">
                {{ row.altTitle }}
              </p>
              <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
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
            <!-- Linking by hand, and mark watched: a round icon button like on Shows, at the card's bottom right. -->
            <div class="flex shrink-0 flex-col items-end gap-2">
              <UDropdownMenu v-if="menu(row).length" :items="menu(row)" :content="{ align: 'end' }">
                <UButton
                  icon="i-lucide-ellipsis"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  aria-label="More"
                />
              </UDropdownMenu>
              <UButton
                class="mt-auto rounded-full p-2"
                :ui="{ leadingIcon: 'size-6' }"
                icon="i-lucide-check-check"
                title="Mark watched"
                aria-label="Mark watched"
                variant="solid"
                size="sm"
                @click="mark(row)"
              />
            </div>
          </div>

          <!-- Expanded: every source's own view. -->
          <div
            v-if="open.has(row.key)"
            class="relative mt-3 divide-y divide-default border-t border-default text-sm"
          >
            <template v-for="source in COLUMNS" :key="source">
              <div
                v-if="row.cells[source].absent !== 'not_anime'"
                class="grid grid-cols-[5.5rem_1fr] gap-x-3 py-2.5"
              >
                <ULink
                  v-if="linkOf(row.cells[source])"
                  :to="linkOf(row.cells[source])!"
                  target="_blank"
                  external
                  :title="`${row.cells[source].entry!.title} on ${SOURCE_LABELS[source]}`"
                  class="font-medium"
                >
                  <SourceName :source="source" />
                </ULink>
                <SourceName v-else :source="source" class="font-medium" />

                <div class="min-w-0 space-y-0.5">
                  <template v-if="row.cells[source].entry">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <UBadge
                        :label="stateLabel(row.cells[source])"
                        :color="stateColor(row.cells[source])"
                        variant="subtle"
                        size="sm"
                      />
                      <span v-if="row.cells[source].entry!.watchedBefore" class="text-xs text-muted"
                        >watched before{{
                          row.cells[source].entry!.watchedAt
                            ? ` (${date(row.cells[source].entry!.watchedAt)})`
                            : ""
                        }}</span
                      >
                      <span
                        v-else-if="row.cells[source].entry!.state === 'watched'"
                        class="text-xs text-muted"
                        >{{ date(row.cells[source].entry!.watchedAt) ?? "" }}</span
                      >
                    </div>
                    <SourceLinks
                      v-if="row.cells[source].entry!.title !== row.title"
                      :links="[
                        { label: row.cells[source].entry!.title, url: linkOf(row.cells[source]) },
                      ]"
                      :title="row.cells[source].entry!.title"
                      class="block text-xs text-muted line-clamp-2 break-words"
                    />
                  </template>
                  <UButton
                    v-else-if="row.cells[source].absent === 'not_linked'"
                    :label="`Add to ${SOURCE_LABELS[source]}`"
                    icon="i-lucide-plus"
                    variant="link"
                    size="xs"
                    class="p-0"
                    @click="fill(row)"
                  />
                  <div v-else class="flex flex-wrap items-center gap-x-2">
                    <component
                      :is="absentUrl(row, source) ? 'a' : 'span'"
                      :href="absentUrl(row, source) ?? undefined"
                      target="_blank"
                      rel="noopener"
                      class="text-muted"
                      :class="
                        absentUrl(row, source) && 'underline decoration-dotted underline-offset-2'
                      "
                      >{{ absentLabel(row.cells[source]) }}</component
                    >
                    <UButton
                      v-if="fillable(row)"
                      label="Add"
                      icon="i-lucide-plus"
                      variant="link"
                      size="xs"
                      class="p-0"
                      @click="fill(row)"
                    />
                  </div>
                </div>
              </div>
            </template>
          </div>
        </MediaCard>
      </MasonryGrid>

      <MovieAddModal v-model:open="addOpen" @added="refresh()" />
      <MovieAddModal
        v-if="fillTarget"
        v-model:open="fillOpen"
        :row-key="fillTarget.key"
        :title="fillTarget.title"
        @added="refresh()"
      />
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
