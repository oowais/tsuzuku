<script setup lang="ts">
useSeoMeta({ title: 'Settings · Tsuzuku' })

const LABELS: Record<string, string> = {
  trakt: 'Trakt',
  simkl: 'Simkl',
  mal: 'MyAnimeList',
  tmdb: 'TMDB',
  anilist: 'AniList'
}
const OAUTH_SOURCES = ['trakt', 'simkl', 'mal']

const ERRORS: Record<string, string> = {
  denied: 'Authorization was not granted.',
  invalid_state: 'The sign-in link expired or did not match this browser. Try again.',
  exchange_failed: 'The source did not return a token. Try again.',
  rate_limited: 'The source is rate limiting us. Try again shortly.',
  config_missing: 'Client ID or secret is missing in .env.'
}

const toast = useToast()
const { data: sources, refresh, status } = await useFetch('/api/sources/status')

// Backups: a copy of the database made on a click, kept in the backups folder next to it, downloadable.
const { data: backups, refresh: refreshBackups } = await useFetch('/api/backups')
const backingUp = ref(false)
async function backUp() {
  backingUp.value = true
  try {
    const b = await $fetch<{ name: string }>('/api/backups', { method: 'POST' })
    toast.add({ title: 'Backup made', description: b.name, color: 'success', icon: 'i-lucide-circle-check' })
    await refreshBackups()
  } catch (e) {
    toast.add({ title: 'Backup failed', description: String((e as Error).message), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    backingUp.value = false
  }
}
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const exact = (at: string | Date) => new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

// Report the outcome of an OAuth callback once, then clean the URL.
const route = useRoute()
const router = useRouter()
onMounted(() => {
  const { connected, error, source } = route.query
  if (typeof connected === 'string') {
    toast.add({ title: `${LABELS[connected] ?? connected} connected`, color: 'success', icon: 'i-lucide-circle-check' })
  } else if (typeof error === 'string') {
    toast.add({
      title: `Could not connect ${typeof source === 'string' ? LABELS[source] ?? source : 'source'}`,
      description: ERRORS[error] ?? error,
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  }
  if (connected || error) router.replace({ query: {} })
})
</script>

<template>
  <UContainer class="py-4 sm:py-8">
    <UPageHeader
      title="Settings"
      description="Connect your sources. Tokens are stored encrypted on this server."
    >
      <template #links>
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="refresh()"
        />
      </template>
    </UPageHeader>

    <UPageBody>
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <ul class="divide-y divide-default">
          <li
            v-for="s in sources"
            :key="s.source"
            class="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <SourceName
              :source="s.source"
              :label="LABELS[s.source] ?? s.source"
              class="font-medium min-w-32"
            />

            <SourceStatusChip
              :status="s.status"
              :connected="s.connected"
              :needs-auth="OAUTH_SOURCES.includes(s.source)"
              :blocked-until="s.blockedUntil"
              :last-fetch-at="s.lastFetchAt"
              :last-error="s.lastError"
            />

            <div class="ms-auto">
              <UButton
                v-if="OAUTH_SOURCES.includes(s.source)"
                :to="`/api/auth/${s.source}/start`"
                external
                :label="s.connected ? 'Reconnect' : 'Connect'"
                :color="s.status === 'auth_expired' ? 'error' : s.connected ? 'neutral' : 'primary'"
                :variant="s.connected && s.status !== 'auth_expired' ? 'outline' : 'solid'"
                size="sm"
              />
              <span
                v-else
                class="text-sm text-muted"
              >No sign-in needed</span>
            </div>
          </li>
        </ul>
      </UCard>

      <section class="space-y-2">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="text-lg font-semibold">
              Backups
            </h2>
            <p class="text-sm text-muted">
              A copy of the database: your links, offsets, accepted differences and write log. Source tokens are in it
              encrypted; the key is not. The newest 14 are kept.
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
              <span
                class="font-medium"
                :title="b.name"
              >{{ exact(b.createdAt) }}</span>
              <span class="text-muted">{{ relativeTime(String(b.createdAt)) }} · {{ size(b.size) }}</span>
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
            <li
              v-if="!backups?.length"
              class="px-4 py-3 text-sm text-muted"
            >
              No backups yet.
            </li>
          </ul>
        </UCard>
      </section>
    </UPageBody>
  </UContainer>
</template>
