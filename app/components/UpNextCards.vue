<script setup lang="ts">
import type { DiffReason } from "#shared/utils/diff-reasons";
import { formatLabel, isSideStory } from "#shared/utils/formats";
import { episodeLabel } from "#shared/utils/source-links";

// One card per show (#54). Collapsed: poster, title, the next episode as chips (number, air date) over its
// name, and the action; progress and episodes left share the footer. When the sources
// differ, each one's next episode stays on the card and the edge is marked, so a difference is never
// hidden in the expanded part. A Coming back sequel for a show nothing links is on the card too. Expanded: every source's own view, its own "mark watched", and accept / undo.
type Cell = NonNullable<InstanceType<typeof import("./UpNextCell.vue").default>["$props"]["cell"]>;
type Source = "trakt" | "simkl" | "mal";
interface Row {
  key: string;
  title: string;
  kind: string;
  differs: boolean;
  accepted: boolean;
  agrees: boolean;
  signature: string;
  images: string[];
  cells: Partial<Record<Source, Cell>>;
  // Caught-up rows: when the next episode airs, per source that knows (#62).
  upcoming?: {
    source: "trakt" | "anilist";
    episode: string;
    title: string | null;
    airsAt: string;
    url: string;
  }[];
  // Differing rows: the likely causes (#78).
  reasons?: DiffReason[];
  // The next anime season can be started on Simkl / MAL, or found by a search when nothing links it (#66).
  start?: { sources: Source[]; search: boolean };
}
const props = defineProps<{ rows: Row[]; empty?: string; sequels?: ComingBackSequel[] }>();
const emit = defineEmits<{
  accepted: [key: string, accepted: boolean];
  mark: [row: { key: string; title: string; signature: string }, source?: Source];
  start: [row: { key: string; title: string }, search: boolean, malId?: number];
}>();

// For a show nothing links: the Coming back sequels named like it, offered before a search (shared lookup).
const sequelsFor = (row: Row) =>
  row.start?.search && props.sequels ? sequelsForShow(row.title, props.sequels) : [];
// The sequel's name without the show's own, so "Show Season 2" on the Show card reads "Season 2".
function sequelName(row: Row, q: ComingBackSequel) {
  const rest = q.title.toLowerCase().startsWith(row.title.toLowerCase())
    ? q.title.slice(row.title.length).replace(/^[\s:\-–]+/, "")
    : "";
  return rest || q.title;
}
const COLUMNS = ["trakt", "simkl", "mal"] as const;
const toast = useToast();

// The progress style picked in Settings (progress-styles.ts). Segments, Big number and Aired are drawn under the
// card (CardProgress); the others on the card: a half ring over Mark watched, a bar beside the poster, the right
// edge filling up, or the poster in grey above how far you are.
const { style: progressStyle } = useProgressStyle();
const underCard = computed(() =>
  progressStyle.value === "segments" ||
  progressStyle.value === "number" ||
  progressStyle.value === "aired"
    ? progressStyle.value
    : null,
);
const pctOf = (row: Row) => {
  const p = progress(row);
  return p ? Math.round((p.watched / p.episodes) * 100) : 0;
};
const nextAired = (row: Row) => !!lead(row)?.air && !lead(row)!.air!.future;

const withEntry = (row: Row) =>
  COLUMNS.flatMap((s) => (row.cells[s]?.entry ? [row.cells[s]!] : []));

// The episode the card leads with: the one the agreeing sources share (in Trakt's numbering), or the only
// source's. None when the sources differ: then each one's is shown.
function lead(row: Row) {
  const cells = withEntry(row);
  const shared = row.agrees
    ? cells.filter((c) => c.state === "in_sync")
    : !row.differs && cells.length === 1
      ? cells
      : [];
  if (!shared.length) return null;
  const first = shared[0]!;
  const next = first.traktNext ?? first.entry!.next;
  const airedAt = shared.map((c) => c.entry!.next?.airedAt).find(Boolean) ?? null;
  const date = shortDate(airedAt);
  return {
    episode: next ? episodeLabel(next) : null,
    name: shared.map((c) => c.entry!.next?.title).find(Boolean) ?? null,
    air: date
      ? {
          text: isFuture(airedAt) ? `${date} · ${relativeTime(airedAt)}` : date,
          date,
          relative: relativeTime(airedAt),
          future: isFuture(airedAt),
        }
      : null,
  };
}

// "Mark watched" on the card: every source when they agree, else the one source that can be marked when
// it is alone. Otherwise the per-source buttons are in the expanded card.
function action(row: Row): { source?: Source } | null {
  if (row.agrees) return {};
  if (row.differs) return null;
  const markable = COLUMNS.filter(
    (s) => row.cells[s]?.entry?.next && !row.cells[s]!.blocked && !row.cells[s]!.stale,
  );
  if (markable.length !== 1) return null;
  return { source: markable[0] };
}

// Per-source problems worth seeing without opening the card.
function flags(row: Row) {
  return COLUMNS.flatMap((s): { source: Source; label: string; color: "warning" | "neutral" }[] => {
    const c = row.cells[s];
    if (!c) return [];
    if (c.blocked) return [{ source: s, label: "rate limited", color: "warning" }];
    if (c.stale) return [{ source: s, label: "stale", color: "neutral" }];
    return [];
  });
}
// Progress at the bottom of the card, from one source (named on hover only): Simkl first (it counts a show's
// seasons together; for anime, the entry's own episodes), else Trakt, else MAL.
function progress(row: Row) {
  const c = (["simkl", "trakt", "mal"] as const)
    .map((s) => row.cells[s])
    .find((c) => c?.entry && c.entry.episodes);
  if (!c) return null;
  const { watched, episodes } = c.entry!;
  return { source: c.source, watched: Math.min(watched, episodes!), episodes: episodes! };
}
// "Fri 16 Oct, 17:00" in the viewer's own time zone (rendered in the browser only).
const airTime = (at: string) =>
  new Date(at).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const sideStory = (row: Row) =>
  withEntry(row)
    .map((c) => c.entry!.format)
    .find((f) => isSideStory(f)) ?? null;
// When the sources agree, when you last watched, once under the card's title: the newest time Trakt or Simkl recorded
// (MAL only knows when its entry changed, so it counts only when it is the only one). Null when they differ:
// then each source says its own, which shows which one missed a mark.
function lastWatched(row: Row) {
  if (row.differs) return null;
  const cells = withEntry(row).filter((c) => c.entry!.lastActivityAt);
  const watched = cells.filter((c) => c.source !== "mal");
  // Sources write times with different offsets, so they are compared as dates, not as text.
  const at = (watched.length ? watched : cells)
    .map((c) => c.entry!.lastActivityAt!)
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1);
  return at ? { at, updated: !watched.length } : null;
}
const notPlaced = (row: Row) => COLUMNS.some((s) => row.cells[s]?.state === "not_placed");

// Opened cards (MediaCard opens on a click or Enter / Space).
const open = reactive(new Set<string>());
const toggle = (key: string) => (open.has(key) ? open.delete(key) : open.add(key));

const busy = ref<string | null>(null);
async function setAccepted(row: Row, accepted: boolean) {
  busy.value = row.key;
  try {
    if (accepted)
      await $fetch("/api/up-next/accept", {
        method: "POST",
        body: { rowKey: row.key, signature: row.signature },
      });
    else await $fetch("/api/up-next/undo-accept", { method: "POST", body: { rowKey: row.key } });
    emit("accepted", row.key, accepted);
  } catch (e) {
    toast.add({
      title: "Could not save",
      description: String((e as Error).message),
      color: "error",
    });
  } finally {
    busy.value = null;
  }
}

const { imageFor } = usePosterImage();
const edge = (row: Row) =>
  row.differs && !row.accepted ? "warning" : row.accepted ? "accented" : "default";
</script>

<template>
  <div>
    <MasonryGrid
      v-slot="{ item: row }"
      :items="rows"
      :item-key="(r) => r.key"
      :columns="{ lg: 2, '2xl': 3 }"
    >
      <MediaCard
        class="relative overflow-hidden rounded-xl p-3 sm:p-4"
        :edge="edge(row)"
        :backdrop="imageFor(row.images)"
        openable
        :open="open.has(row.key)"
        @toggle="toggle(row.key)"
      >
        <div
          v-if="progressStyle === 'edge' && progress(row)"
          aria-hidden="true"
          class="absolute inset-y-0 end-0 flex w-1 flex-col-reverse bg-accented/60"
        >
          <div
            class="bg-primary"
            :style="{ height: `${pctOf(row)}%`, boxShadow: '0 0 8px var(--card-glow)' }"
          />
        </div>
        <div class="relative min-w-0">
          <div class="flex gap-3 sm:gap-4">
            <div class="relative flex shrink-0 gap-1.5 self-start">
              <MediaPoster :images="row.images" size="lg" />
              <div
                v-if="progressStyle === 'poster' && progress(row)"
                aria-hidden="true"
                class="absolute inset-x-0 top-0 overflow-hidden rounded-t-(--poster-radius-lg) border-b-2 border-primary backdrop-grayscale backdrop-brightness-75"
                :style="{ height: `${100 - pctOf(row)}%` }"
              />
              <template v-if="progressStyle === 'vertical' && progress(row)">
                <div
                  aria-hidden="true"
                  class="flex w-1.5 flex-col-reverse overflow-hidden rounded-full bg-accented"
                >
                  <div
                    class="rounded-full bg-primary"
                    :style="{ height: `${pctOf(row)}%`, boxShadow: '0 0 8px var(--card-glow)' }"
                  />
                </div>
                <span
                  class="text-xs tabular-nums text-muted [writing-mode:vertical-rl] rotate-180 self-end"
                  >{{ progress(row)!.watched }}/{{ progress(row)!.episodes }}</span
                >
              </template>
            </div>

            <div class="@container min-w-0 flex-1 flex flex-col gap-2 self-stretch">
              <h3
                class="text-2xl font-extrabold leading-tight tracking-tight text-highlighted line-clamp-2 break-words"
              >
                {{ row.title }}
              </h3>
              <!-- When you last watched, once for the card while the sources agree (each source's own time is in the
                   expanded part when they differ). Client-only: the time is relative to now. -->
              <ClientOnly>
                <p
                  v-if="lastWatched(row)"
                  class="-mt-1 flex items-center gap-1 text-xs text-muted"
                  :title="new Date(lastWatched(row)!.at).toLocaleString('en-GB')"
                >
                  <UIcon name="i-lucide-history" class="size-3.5 shrink-0" />
                  {{ lastWatched(row)!.updated ? "Updated" : "Watched" }}
                  {{ relativeTime(lastWatched(row)!.at) }}
                </p>
              </ClientOnly>

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

              <div v-if="lead(row)" class="space-y-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <UBadge
                    :label="lead(row)!.episode ?? 'caught up'"
                    color="primary"
                    variant="soft"
                    class="font-semibold tabular-nums"
                  />
                  <UBadge
                    v-if="lead(row)!.air"
                    :label="lead(row)!.air!.text"
                    :icon="lead(row)!.air!.future ? 'i-lucide-clock' : 'i-lucide-calendar'"
                    :color="lead(row)!.air!.future ? 'warning' : 'neutral'"
                    variant="subtle"
                  />
                </div>
                <p
                  v-if="lead(row)!.name"
                  class="text-sm text-default leading-snug line-clamp-2"
                  :title="lead(row)!.name!"
                >
                  {{ lead(row)!.name }}
                </p>
              </div>
              <div v-else class="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                <span
                  v-for="c in withEntry(row)"
                  :key="c.source"
                  class="inline-flex items-center gap-1"
                  :title="
                    c.traktNext && c.source !== 'trakt'
                      ? `Trakt ${episodeLabel(c.traktNext)}`
                      : undefined
                  "
                >
                  <SourceIcon :source="c.source" />
                  <span
                    :class="c.state === 'differs' && !row.accepted ? 'font-medium' : 'text-muted'"
                    >{{ c.entry!.next ? episodeLabel(c.entry!.next) : "caught up" }}</span
                  >
                </span>
              </div>

              <DiffReasons
                v-if="row.differs && !row.accepted && row.reasons?.length"
                :reasons="row.reasons"
                @mark="(s) => emit('mark', row, s)"
              />

              <ul v-if="row.upcoming?.length" class="space-y-0.5 text-sm">
                <li
                  v-for="u in row.upcoming"
                  :key="`${u.source}:${u.url}`"
                  class="flex flex-wrap items-center gap-x-1"
                  :class="isFuture(u.airsAt) ? 'text-default' : 'text-muted'"
                >
                  <SourceIcon :source="u.source" />
                  <ULink
                    :to="u.url"
                    target="_blank"
                    external
                    class="font-medium underline decoration-dotted underline-offset-2"
                    >{{ u.episode }}</ULink
                  >
                  <ClientOnly>
                    <span>{{ isFuture(u.airsAt) ? "airs" : "aired" }} {{ airTime(u.airsAt) }}</span>
                    <span class="text-muted">({{ relativeTime(u.airsAt) }})</span>
                  </ClientOnly>
                </li>
              </ul>

              <div
                v-for="q in sequelsFor(row)"
                :key="q.malId"
                class="rounded-md bg-elevated/60 px-2.5 py-2 text-sm space-y-1.5"
              >
                <div class="flex flex-wrap items-center gap-1.5">
                  <UIcon name="i-lucide-calendar-clock" class="size-4 shrink-0 text-info" />
                  <span class="text-info font-medium">Coming back</span>
                  <UBadge
                    v-if="q.onPlanToWatch"
                    label="Plan to Watch"
                    color="neutral"
                    variant="outline"
                    size="sm"
                  />
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <a
                    :href="`https://myanimelist.net/anime/${q.malId}`"
                    :title="q.title"
                    target="_blank"
                    rel="noopener"
                    class="min-w-0 font-medium line-clamp-1 hover:underline"
                    >{{ sequelName(row, q) }}</a
                  >
                  <UButton
                    label="Start"
                    :title="`Start ${q.title} on Simkl / MAL`"
                    icon="i-lucide-play"
                    size="xs"
                    variant="soft"
                    @click="emit('start', row, true, q.malId)"
                  />
                </div>
              </div>

              <!-- Actions at the bottom right: Start next season on a line of its own, Mark watched under it. -->
              <div class="mt-auto space-y-2 pt-1">
                <div v-if="row.start?.sources.length" class="flex justify-end">
                  <UButton
                    label="Start next season"
                    :title="`Not on your ${row.start.sources.map((s) => SOURCE_LABELS[s]).join(' or ')} watching list yet`"
                    icon="i-lucide-circle-play"
                    color="neutral"
                    variant="soft"
                    size="sm"
                    @click="emit('start', row, false)"
                  />
                </div>
                <div class="flex flex-wrap items-center justify-end gap-2">
                  <!-- Mark watched: a round icon button, twice the usual icon (16px to 32px); the double
                     tick marks every source, a source's icon marks that one. Named on hover and to screen readers. -->
                  <!-- Half gauge: a half ring over Mark watched, the count beside it. A card without the button (sources
                     differ, or none can be marked) gets the count inside the ring instead. -->
                  <span
                    v-if="progressStyle === 'gauge' && progress(row) && action(row)"
                    class="me-3 text-end text-xs tabular-nums text-muted"
                  >
                    <span class="block text-default"
                      >{{ progress(row)!.watched }}/{{ progress(row)!.episodes }}</span
                    >
                    {{ progress(row)!.episodes - progress(row)!.watched }} left
                  </span>
                  <div v-if="progressStyle === 'gauge' && progress(row)" class="relative size-12">
                    <svg
                      viewBox="0 0 72 72"
                      aria-hidden="true"
                      class="pointer-events-none absolute -inset-3 size-18 overflow-visible"
                    >
                      <path
                        d="M4 36 A32 32 0 0 1 68 36"
                        fill="none"
                        stroke-width="5"
                        stroke-linecap="round"
                        class="stroke-(--ui-border-accented)"
                      />
                      <path
                        d="M4 36 A32 32 0 0 1 68 36"
                        fill="none"
                        stroke-width="5"
                        stroke-linecap="round"
                        pathLength="100"
                        :stroke-dasharray="`${pctOf(row)} 100`"
                        class="stroke-primary"
                        style="filter: drop-shadow(0 0 4px var(--card-glow))"
                      />
                    </svg>
                    <UButton
                      v-if="action(row)"
                      class="rounded-full p-2"
                      :ui="{ leadingIcon: 'size-8' }"
                      :title="
                        action(row)!.source
                          ? `Mark watched on ${SOURCE_LABELS[action(row)!.source!]}`
                          : `Mark watched on every source`
                      "
                      :aria-label="
                        action(row)!.source
                          ? `Mark watched on ${SOURCE_LABELS[action(row)!.source!]}`
                          : `Mark watched on every source`
                      "
                      :icon="
                        action(row)!.source
                          ? SOURCE_ICONS[action(row)!.source!]!.icon
                          : 'i-lucide-check-check'
                      "
                      variant="solid"
                      size="sm"
                      @click="emit('mark', row, action(row)!.source)"
                    />
                    <span
                      v-else
                      class="absolute inset-0 flex flex-col items-center justify-center pt-1 leading-none tabular-nums"
                    >
                      <span class="text-sm font-bold text-highlighted">{{
                        progress(row)!.watched
                      }}</span>
                      <span class="text-[10px] text-muted">of {{ progress(row)!.episodes }}</span>
                    </span>
                  </div>
                  <UButton
                    v-else-if="action(row)"
                    class="rounded-full p-2"
                    :ui="{ leadingIcon: 'size-8' }"
                    :title="
                      action(row)!.source
                        ? `Mark watched on ${SOURCE_LABELS[action(row)!.source!]}`
                        : `Mark watched on every source`
                    "
                    :aria-label="
                      action(row)!.source
                        ? `Mark watched on ${SOURCE_LABELS[action(row)!.source!]}`
                        : `Mark watched on every source`
                    "
                    :icon="
                      action(row)!.source
                        ? SOURCE_ICONS[action(row)!.source!]!.icon
                        : 'i-lucide-check-check'
                    "
                    variant="solid"
                    size="sm"
                    @click="emit('mark', row, action(row)!.source)"
                  />
                </div>
              </div>
            </div>
          </div>

          <CardProgress
            v-if="progress(row) && underCard"
            class="mt-3"
            :next-aired="nextAired(row)"
            :title="`${progress(row)!.watched} of ${progress(row)!.episodes} episodes watched on ${SOURCE_LABELS[progress(row)!.source]}`"
            :watched="progress(row)!.watched"
            :episodes="progress(row)!.episodes"
            :variant="underCard"
          />
        </div>

        <!-- Expanded: every source's own view, across the whole card. -->
        <div
          v-if="open.has(row.key)"
          class="relative mt-3 border-t border-default divide-y divide-default"
        >
          <template v-for="c in COLUMNS" :key="c">
            <UpNextCell
              v-if="row.cells[c]"
              :cell="row.cells[c]"
              :kind="row.kind"
              :row-title="row.title"
              :accepted="row.accepted"
              :markable="!row.agrees"
              :hide-activity="!!lastWatched(row)"
              class="py-2.5"
              @mark="emit('mark', row, c)"
            />
          </template>
          <div v-if="row.start?.search" class="pt-2.5 text-sm text-muted">
            {{ sequelsFor(row).length ? "Something else?" : "An anime?" }}
            <UButton
              label="Find it and start it on Simkl / MAL"
              variant="link"
              size="sm"
              class="p-0"
              @click="emit('start', row, true)"
            />
          </div>
          <div v-if="row.differs" class="pt-2.5">
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
            <div v-else class="flex flex-wrap items-center gap-1 text-xs text-muted">
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
      </MediaCard>
    </MasonryGrid>
    <div v-if="!rows.length" class="rounded-md border border-default px-4 py-3 text-sm text-muted">
      {{ empty ?? "Nothing here." }}
    </div>
  </div>
</template>
