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

const { data: sources, refresh, status } = await useFetch('/api/sources/status')

// Report the outcome of an OAuth callback once, then clean the URL.
const route = useRoute()
const router = useRouter()
const toast = useToast()
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
  <UContainer class="py-8">
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
    </UPageBody>
  </UContainer>
</template>
