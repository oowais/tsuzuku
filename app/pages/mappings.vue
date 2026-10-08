<script setup lang="ts">
useSeoMeta({ title: 'Mappings · Tsuzuku' })

const SOURCE_LABELS: Record<string, string> = { trakt: 'Trakt', simkl: 'Simkl', mal: 'MAL' }

const { data, refresh, status } = await useFetch('/api/mappings')
const toast = useToast()

type Overview = NonNullable<typeof data.value>
type EntryView = Overview['entries'][number]
type Proposal = Overview['proposals'][number]

const entryByKey = computed(() => new Map((data.value?.entries ?? []).map(e => [e.key, e])))
const entry = (key: string) => entryByKey.value.get(key)

// Every source that lists the same anime entry, for showing "MAL, Simkl" next to a title.
function animeSources(malId: number | undefined, simklId: number | undefined) {
  return (data.value?.entries ?? [])
    .filter(e => e.kind === 'anime' && ((malId !== undefined && e.ids.mal === malId) || (simklId !== undefined && e.ids.simkl === simklId)))
    .map(e => SOURCE_LABELS[e.source])
}

function episodeLabel(next: EntryView['next']) {
  if (!next) return 'caught up'
  return next.season !== null ? `S${next.season}E${next.number}` : `E${next.number}`
}

// Season and offset per proposal, editable before confirming.
const edits = reactive<Record<string, { traktSeason: number | null, episodeOffset: number }>>({})
watch(data, (d) => {
  for (const p of d?.proposals ?? []) edits[p.animeKey] ??= { ...p.placement }
}, { immediate: true })

const busy = ref<string | null>(null)

async function confirm(p: Proposal) {
  const edit = edits[p.animeKey]!
  if (edit.traktSeason === null) {
    toast.add({ title: 'Pick a Trakt season first', color: 'warning', icon: 'i-lucide-circle-alert' })
    return
  }
  busy.value = p.animeKey
  try {
    await $fetch('/api/mappings/confirm', {
      method: 'POST',
      body: { traktKey: p.traktKey, animeKey: p.animeKey, traktSeason: edit.traktSeason, episodeOffset: edit.episodeOffset }
    })
    toast.add({ title: 'Linked', color: 'success', icon: 'i-lucide-circle-check' })
    await refresh()
  } catch (err) {
    const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? String(err)
    toast.add({ title: 'Could not link', description: message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    busy.value = null
  }
}

async function reject(p: Proposal) {
  busy.value = p.animeKey
  try {
    await $fetch('/api/mappings/reject', { method: 'POST', body: { traktKey: p.traktKey, animeKey: p.animeKey } })
    toast.add({ title: 'Will not suggest this again', color: 'neutral', icon: 'i-lucide-x' })
    await refresh()
  } finally {
    busy.value = null
  }
}

// What the chosen season and offset mean, in plain words.
function meaning(p: Proposal) {
  const edit = edits[p.animeKey]
  const trakt = entry(p.traktKey)
  const anime = entry(p.animeKey)
  if (!edit || edit.traktSeason === null || !trakt?.next || !anime) return null
  const animeEpisode = trakt.next.number - edit.episodeOffset
  return `Trakt S${edit.traktSeason}E${trakt.next.number} = ${anime.title} E${animeEpisode}`
}

const linked = computed(() => (data.value?.mappings ?? []).map((m) => {
  const trakt = m.traktId !== null ? data.value?.entries.find(e => e.source === 'trakt' && e.ids.trakt === m.traktId) : undefined
  return {
    id: m.id,
    status: m.status,
    kind: m.kind,
    trakt: m.traktId !== null ? (trakt?.title ?? `Trakt #${m.traktId}`) : null,
    simklShow: m.kind === 'show' && m.simklId !== null ? data.value?.entries.find(e => e.ids.simkl === m.simklId)?.title ?? `Simkl #${m.simklId}` : null,
    seasons: m.seasons.map((s) => {
      const anime = data.value?.entries.find(e => e.kind === 'anime' && ((s.malId !== null && e.ids.mal === s.malId) || (s.simklId !== null && e.ids.simkl === s.simklId)))
      return {
        id: s.id,
        title: anime?.title ?? (s.malId !== null ? `MAL #${s.malId}` : `Simkl #${s.simklId}`),
        sources: animeSources(s.malId ?? undefined, s.simklId ?? undefined),
        traktSeason: s.traktSeason,
        episodeOffset: s.episodeOffset
      }
    })
  }
}))
</script>

<template>
  <UContainer class="py-8">
    <UPageHeader
      title="Mappings"
      description="How your shows line up across Trakt, Simkl and MAL. Links proven by shared IDs are made for you; everything else waits for your confirm."
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
      <UAlert
        v-if="data?.sources.anilist.status !== 'ok' && data"
        color="warning"
        icon="i-lucide-circle-alert"
        title="AniList is not answering right now"
        description="Season chains may be incomplete. Refresh in a minute."
      />

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">
          Needs your confirm
          <UBadge
            :label="String(data?.proposals.length ?? 0)"
            color="neutral"
            variant="subtle"
          />
        </h2>

        <p
          v-if="!data?.proposals.length"
          class="text-muted"
        >
          Nothing to confirm.
        </p>

        <UCard
          v-for="p in data?.proposals ?? []"
          :key="p.animeKey"
        >
          <div class="flex flex-col gap-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <div class="text-xs text-muted">
                  Trakt
                </div>
                <div class="font-medium">
                  {{ entry(p.traktKey)?.title }}
                </div>
                <div class="text-sm text-muted">
                  next {{ episodeLabel(entry(p.traktKey)?.next ?? null) }}
                </div>
              </div>
              <div>
                <div class="text-xs text-muted">
                  {{ animeSources(entry(p.animeKey)?.ids.mal, entry(p.animeKey)?.ids.simkl).join(', ') }}
                </div>
                <div class="font-medium">
                  {{ entry(p.animeKey)?.title }}
                </div>
                <div class="text-sm text-muted">
                  next {{ episodeLabel(entry(p.animeKey)?.next ?? null) }}
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 text-sm">
              <UBadge
                v-if="p.via === 'ids'"
                label="Same show by ID"
                color="success"
                variant="subtle"
              />
              <UBadge
                v-else
                :label="`Title match ${Math.round(p.score * 100)}%`"
                color="warning"
                variant="subtle"
              />
              <span
                v-if="p.chain.length > 1"
                class="text-muted"
              >
                Season {{ p.chain.length }} on AniList: {{ p.chain.map(c => c.title).join(' → ') }}
              </span>
            </div>

            <div class="flex flex-wrap items-end gap-3">
              <UFormField label="Trakt season">
                <UInputNumber
                  v-model="edits[p.animeKey]!.traktSeason"
                  :min="0"
                  class="w-28"
                />
              </UFormField>
              <UFormField
                label="Episode offset"
                help="Trakt episode minus this entry's episode"
              >
                <UInputNumber
                  v-model="edits[p.animeKey]!.episodeOffset"
                  class="w-28"
                />
              </UFormField>
              <span
                v-if="meaning(p)"
                class="text-sm pb-2"
              >
                {{ meaning(p) }}
                <UBadge
                  v-if="!p.placement.fromProgress"
                  label="check this"
                  color="warning"
                  variant="subtle"
                />
              </span>
            </div>

            <div class="flex gap-2">
              <UButton
                label="Confirm"
                icon="i-lucide-check"
                :loading="busy === p.animeKey"
                @click="confirm(p)"
              />
              <UButton
                label="Not this show"
                icon="i-lucide-x"
                color="neutral"
                variant="outline"
                :disabled="busy === p.animeKey"
                @click="reject(p)"
              />
            </div>
          </div>
        </UCard>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">
          Linked
        </h2>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <ul class="divide-y divide-default">
            <li
              v-for="m in linked"
              :key="m.id"
              class="px-4 py-3 space-y-1"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium">{{ m.trakt ?? m.simklShow ?? 'Not on Trakt' }}</span>
                <UBadge
                  :label="m.status === 'confirmed' ? 'confirmed' : 'by ID'"
                  :color="m.status === 'confirmed' ? 'success' : 'neutral'"
                  variant="subtle"
                />
                <span
                  v-if="m.simklShow && m.trakt"
                  class="text-sm text-muted"
                >Simkl: {{ m.simklShow }}</span>
              </div>
              <div
                v-for="s in m.seasons"
                :key="s.id"
                class="text-sm text-muted"
              >
                {{ s.traktSeason !== null ? `Trakt S${s.traktSeason}` : 'Not placed in a Trakt season' }}
                = {{ s.title }} ({{ s.sources.join(', ') || 'not on your lists now' }})
                <template v-if="s.traktSeason !== null && s.episodeOffset !== 0">
                  , offset {{ s.episodeOffset }}
                </template>
              </div>
            </li>
            <li
              v-if="!linked.length"
              class="px-4 py-3 text-muted"
            >
              No links yet.
            </li>
          </ul>
        </UCard>
      </section>
    </UPageBody>
  </UContainer>
</template>
