<script setup lang="ts">
// Everything in Settings, shown in the panel over the current page (useSettingsPanel, app.vue): sources and Mappings,
// card style, light or dark, theme and backups. The grids follow the panel's width (container queries), not the
// screen's.
const LABELS: Record<string, string> = {
  trakt: "Trakt",
  simkl: "Simkl",
  mal: "MyAnimeList",
  tmdb: "TMDB",
  anilist: "AniList",
};
const OAUTH_SOURCES = ["trakt", "simkl", "mal"];

const ERRORS: Record<string, string> = {
  denied: "Authorization was not granted.",
  invalid_state: "The sign-in link expired or did not match this browser. Try again.",
  exchange_failed: "The source did not return a token. Try again.",
  rate_limited: "The source is rate limiting us. Try again shortly.",
  config_missing: "Client ID or secret is missing in .env.",
};

const toast = useToast();
const { id: themeId } = useTheme();
const { id: cardStyleId, style: cardStyle } = useCardStyle();
const CARD_ICONS: Record<CardStyleId, string> = {
  board: "i-lucide-grip",
  backdrop: "i-lucide-image",
  ticket: "i-lucide-ticket",
};
const { data: sources, refresh, status } = useFetch("/api/sources/status");

// Backups: a copy of the database made nightly or on a click, kept in the backups folder next to it, downloadable.
const { data: backups, refresh: refreshBackups } = useFetch("/api/backups");
const backingUp = ref(false);
async function backUp() {
  backingUp.value = true;
  try {
    const b = await $fetch<{ name: string }>("/api/backups", { method: "POST" });
    toast.add({
      title: "Backup made",
      description: b.name,
      color: "success",
      icon: "i-lucide-circle-check",
    });
    await refreshBackups();
  } catch (e) {
    toast.add({
      title: "Backup failed",
      description: String((e as Error).message),
      color: "error",
      icon: "i-lucide-circle-alert",
    });
  } finally {
    backingUp.value = false;
  }
}
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const exact = (at: string | Date) =>
  new Date(at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

// Report the outcome of a source's sign-in once (the callback returns to the panel), then clean the URL.
const route = useRoute();
const router = useRouter();
onMounted(() => {
  const { connected, error, source, ...rest } = route.query;
  if (typeof connected === "string") {
    toast.add({
      title: `${LABELS[connected] ?? connected} connected`,
      color: "success",
      icon: "i-lucide-circle-check",
    });
  } else if (typeof error === "string") {
    toast.add({
      title: `Could not connect ${typeof source === "string" ? (LABELS[source] ?? source) : "source"}`,
      description: ERRORS[error] ?? error,
      color: "error",
      icon: "i-lucide-circle-alert",
    });
  }
  if (connected || error) router.replace({ query: rest });
});

// Light or dark, or the device's own setting; next to the themes, which each have both.
const colorMode = useColorMode();
const MODES = [
  { value: "system", label: "System", icon: "i-lucide-monitor" },
  { value: "light", label: "Light", icon: "i-lucide-sun" },
  { value: "dark", label: "Dark", icon: "i-lucide-moon" },
];
</script>

<template>
  <div class="@container space-y-8">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">
        Connect your sources. Tokens are stored encrypted on this server.
      </p>
      <UButton
        label="Refresh"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        size="sm"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </div>

    <!-- Sources and Mappings as one grid of compact tiles, so the panel's top is short. Mappings is upkeep, not a
       daily page: Up Next links to it where a link needs you, and it is here. -->
    <ul class="grid gap-2 @lg:grid-cols-2 @4xl:grid-cols-3">
      <li
        v-for="s in sources"
        :key="s.source"
        class="surface-card flex items-center gap-3 rounded-lg border border-default px-3 py-2.5"
      >
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <SourceName
            :source="s.source"
            :label="LABELS[s.source] ?? s.source"
            class="font-medium"
          />
          <SourceStatusChip
            :status="s.status"
            :connected="s.connected"
            :needs-auth="OAUTH_SOURCES.includes(s.source)"
            :blocked-until="s.blockedUntil"
            :last-fetch-at="s.lastFetchAt"
            :last-error="s.lastError"
          />
        </div>
        <UButton
          v-if="OAUTH_SOURCES.includes(s.source)"
          :to="`/api/auth/${s.source}/start`"
          external
          :label="s.connected ? 'Reconnect' : 'Connect'"
          :color="s.status === 'auth_expired' ? 'error' : s.connected ? 'neutral' : 'primary'"
          :variant="s.connected && s.status !== 'auth_expired' ? 'outline' : 'solid'"
          size="sm"
        />
        <span v-else class="shrink-0 text-xs text-muted">No sign-in needed</span>
      </li>
      <li>
        <ULink
          to="/mappings"
          class="surface-card flex h-full items-center gap-3 rounded-lg border border-default px-3 py-2.5 transition-colors hover:bg-elevated/50"
        >
          <UIcon name="i-lucide-link" class="size-5 shrink-0 text-muted" />
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-highlighted">Mappings</span>
            <span class="block text-xs text-muted">
              Confirm, fix or undo links between <SourceName source="trakt" />,
              <SourceName source="simkl" /> and <SourceName source="mal" />.
            </span>
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-muted" />
        </ULink>
      </li>
    </ul>

    <section class="space-y-2">
      <div>
        <h2 class="text-lg font-semibold">Card style</h2>
        <p class="text-sm text-muted">
          How the cards on Shows look, in this browser. Same content in each; works with every
          theme.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Card style"
        class="grid gap-2 @lg:grid-cols-2 @4xl:grid-cols-3"
      >
        <button
          v-for="c in CARD_STYLES"
          :key="c.id"
          type="button"
          role="radio"
          :aria-checked="cardStyle === c.id"
          class="surface-card flex items-center gap-3 rounded-lg border bg-default p-3 text-start transition-colors hover:bg-elevated/50 focus-visible:outline-2 outline-primary"
          :class="cardStyle === c.id ? 'border-primary ring-1 ring-primary' : 'border-default'"
          @click="cardStyleId = c.id"
        >
          <UIcon :name="CARD_ICONS[c.id]" class="size-6 shrink-0 text-primary" />
          <span class="min-w-0">
            <span class="flex items-center gap-1.5 font-medium text-highlighted">
              {{ c.label }}
              <UIcon v-if="cardStyle === c.id" name="i-lucide-check" class="size-4 text-primary" />
            </span>
            <span class="block text-xs text-muted">{{ c.description }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="space-y-2">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">Theme</h2>
          <p class="text-sm text-muted">
            Colours and font for this browser, in light and dark mode. Source logos and chart
            colours stay the same.
          </p>
        </div>
        <!-- Client-only: the saved mode lives in this browser, so the server cannot render the pick. -->
        <ClientOnly>
          <div
            role="radiogroup"
            aria-label="Light or dark"
            class="inline-flex shrink-0 rounded-lg border border-default p-0.5"
          >
            <button
              v-for="m in MODES"
              :key="m.value"
              type="button"
              role="radio"
              :aria-checked="colorMode.preference === m.value"
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 outline-primary"
              :class="
                colorMode.preference === m.value
                  ? 'bg-elevated font-medium text-highlighted'
                  : 'text-muted hover:text-default'
              "
              @click="colorMode.preference = m.value"
            >
              <UIcon :name="m.icon" class="size-4" />
              {{ m.label }}
            </button>
          </div>
        </ClientOnly>
      </div>
      <!-- Compact chips: two across on a narrow panel with the label only (description as a tooltip), the
         description shows once the panel is wide enough. -->
      <div
        role="radiogroup"
        aria-label="Theme"
        class="grid grid-cols-2 gap-1.5 @lg:grid-cols-3 @4xl:grid-cols-4"
      >
        <button
          v-for="t in THEMES"
          :key="t.id"
          type="button"
          role="radio"
          :aria-checked="themeId === t.id"
          :title="t.description"
          class="surface-card flex items-center gap-2 rounded-md border bg-default px-2 py-1.5 text-start transition-colors hover:bg-elevated/50 focus-visible:outline-2 outline-primary"
          :class="themeId === t.id ? 'border-primary ring-1 ring-primary' : 'border-default'"
          @click="themeId = t.id"
        >
          <span class="flex shrink-0 overflow-hidden rounded border border-default">
            <span v-for="c in t.swatches" :key="c" class="h-5 w-1.5" :style="{ background: c }" />
          </span>
          <span class="min-w-0">
            <span class="flex items-center gap-1 text-sm font-medium text-highlighted">
              <span class="truncate">{{ t.label }}</span>
              <UIcon
                v-if="themeId === t.id"
                name="i-lucide-check"
                class="size-3.5 shrink-0 text-primary"
              />
            </span>
            <span class="hidden truncate text-xs text-muted @2xl:block">{{ t.description }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="space-y-2">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 class="text-lg font-semibold">Backups</h2>
          <p class="text-sm text-muted">
            A copy of the database: your links, offsets, accepted differences and write log. Source
            tokens are in it encrypted; the key is not. One is made every night at 03:00; the newest
            14 are kept.
          </p>
        </div>
        <UButton
          label="Back up now"
          icon="i-lucide-database-backup"
          :loading="backingUp"
          @click="backUp()"
        />
      </div>
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <ul class="divide-y divide-default">
          <li
            v-for="b in backups ?? []"
            :key="b.name"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
          >
            <span class="font-medium" :title="b.name">{{ exact(b.createdAt) }}</span>
            <span class="text-muted"
              >{{ relativeTime(String(b.createdAt)) }} · {{ size(b.size) }}</span
            >
            <UButton
              :to="`/api/backups/${encodeURIComponent(b.name)}`"
              external
              download
              label="Download"
              icon="i-lucide-download"
              color="neutral"
              variant="ghost"
              size="sm"
              class="ms-auto"
            />
          </li>
          <li v-if="!backups?.length" class="px-4 py-3 text-sm text-muted">No backups yet.</li>
        </ul>
      </UCard>
    </section>
  </div>
</template>
