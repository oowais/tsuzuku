<script setup lang="ts">
import { episodeLabel, episodeUrl, itemUrl, seasonUrl, type LinkTarget } from '#shared/utils/source-links'

useSeoMeta({ title: 'Mappings · Tsuzuku' })

const SOURCE_LABELS: Record<string, string> = { trakt: 'Trakt', simkl: 'Simkl', mal: 'MAL' }

const { data, refresh, status } = await useFetch('/api/mappings')
const toast = useToast()

type Overview = NonNullable<typeof data.value>
type EntryView = Overview['entries'][number]
type Proposal = Overview['proposals'][number]

const entryByKey = computed(() => new Map((data.value?.entries ?? []).map(e => [e.key, e])))
const entry = (key: string) => entryByKey.value.get(key)

// The same anime entry as listed on each source; Simkl and MAL can disagree on title and progress.
function sameAnime(ids: { mal?: number | null, simkl?: number | null }): EntryView[] {
  return (data.value?.entries ?? []).filter(e => e.kind === 'anime'
    && ((ids.mal != null && e.ids.mal === ids.mal) || (ids.simkl != null && e.ids.simkl === ids.simkl)))
}

// "Simkl + MAL", each name linking to that source's page for the entry.
const sourceLinks = (entries: EntryView[]) => entries.map(e => ({ label: SOURCE_LABELS[e.source]!, url: itemUrl(e) }))

// Each source's own title, once per distinct title (decision #19).
const titles = (entries: EntryView[]) => [...new Set(entries.map(e => e.title))].join(' / ')

// Next episode per source, merged when they agree: "E6 on Simkl + MAL", else "E6 on Simkl · E5 on MAL".
function nextGroups(entries: EntryView[]) {
  const groups = new Map<string, { label: string, links: { label: string, url: string | null }[] }>()
  for (const e of entries) {
    const label = episodeLabel(e.next)
    const group = groups.get(label) ?? { label, links: [] }
    group.links.push({ label: SOURCE_LABELS[e.source]!, url: e.next ? episodeUrl(e, e.next) : itemUrl(e) })
    groups.set(label, group)
  }
  return [...groups.values()]
}

// Link target for a Trakt show reference (on your list or found by Trakt).
const traktTarget = (t: Proposal['trakt']): LinkTarget => ({ source: 'trakt', kind: 'show', ids: { traktSlug: t.slug ?? undefined } })

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
      body: { traktId: p.trakt.trakt, animeKey: p.animeKey, traktSeason: edit.traktSeason, episodeOffset: edit.episodeOffset }
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
    await $fetch('/api/mappings/reject', { method: 'POST', body: { traktId: p.trakt.trakt, animeKey: p.animeKey } })
    toast.add({ title: 'Will not suggest this again', color: 'neutral', icon: 'i-lucide-x' })
    await refresh()
  } finally {
    busy.value = null
  }
}

// What the chosen season and offset mean, with each side's episode linked: at Trakt's next episode when
// the show is on your list, else at the entry's first episode.
function meaning(p: Proposal) {
  const edit = edits[p.animeKey]
  const anime = entry(p.animeKey)
  if (!edit || edit.traktSeason === null || !anime) return null
  const traktNumber = p.trakt.next ? p.trakt.next.number : 1 + edit.episodeOffset
  const traktEp = { season: edit.traktSeason, number: traktNumber }
  const animeEp = { season: null, number: traktNumber - edit.episodeOffset }
  return {
    trakt: { label: `Trakt ${episodeLabel(traktEp)}`, url: episodeUrl(traktTarget(p.trakt), traktEp) },
    anime: sameAnime(anime.ids).map(e => ({ label: `${SOURCE_LABELS[e.source]} ${episodeLabel(animeEp)}`, url: episodeUrl(e, animeEp) }))
  }
}

// "Link to Trakt" dialog for an entry with no Trakt show.
const linking = ref<{ animeKey: string, title: string, query: string } | null>(null)
const linkOpen = computed({
  get: () => linking.value !== null,
  set: (v) => {
    if (!v) linking.value = null
  }
})

// Stored links. An entry no longer on any list still links by its stored ID.
// Anime on your lists with no Trakt show at all and no proposal: only a search can link them.
const unlinked = computed(() => {
  const d = data.value
  if (!d) return []
  const proposed = new Set(d.proposals.flatMap(p => sameAnime(entry(p.animeKey)?.ids ?? {}).map(e => e.key)))
  const withTrakt = new Set(d.mappings.filter(m => m.traktId !== null).flatMap(m => m.seasons.flatMap(s => [s.malId, s.simklId])))
  const seen = new Set<string>()
  const rows = []
  for (const e of d.entries) {
    if (e.kind !== 'anime' || proposed.has(e.key)) continue
    if (withTrakt.has(e.ids.mal ?? null) || withTrakt.has(e.ids.simkl ?? null)) continue
    const group = sameAnime(e.ids)
    const id = group.map(g => g.key).sort().join()
    if (seen.has(id)) continue
    seen.add(id)
    const own = group.find(g => g.source === 'mal') ?? group[0]!
    rows.push({
      key: own.key,
      title: titles(group),
      links: sourceLinks(group),
      format: own.format,
      query: (own.ids.mal !== undefined ? d.searchTitles[own.ids.mal] : null) ?? own.title
    })
  }
  return rows
})

const linked = computed(() => (data.value?.mappings ?? []).map((m) => {
  const trakt = m.traktId !== null ? data.value?.entries.find(e => e.source === 'trakt' && e.ids.trakt === m.traktId) : undefined
  const traktLink: LinkTarget | undefined = m.traktSlug ? { source: 'trakt', kind: 'show', ids: { traktSlug: m.traktSlug } } : trakt
  const simklShow = m.kind === 'show' && m.simklId !== null ? data.value?.entries.find(e => e.source === 'simkl' && e.ids.simkl === m.simklId) : undefined
  return {
    id: m.id,
    status: m.status,
    trakt: m.traktId !== null ? { title: trakt?.title ?? m.traktSlug ?? `Trakt #${m.traktId}`, url: traktLink ? itemUrl(traktLink) : null } : null,
    simklShow: simklShow ? { title: simklShow.title, url: itemUrl(simklShow) } : null,
    seasons: m.seasons.map((s) => {
      const listed = sameAnime({ mal: s.malId, simkl: s.simklId })
      const stored: LinkTarget[] = [
        ...(s.simklId !== null ? [{ source: 'simkl' as const, kind: 'anime' as const, ids: { simkl: s.simklId } }] : []),
        ...(s.malId !== null ? [{ source: 'mal' as const, kind: 'anime' as const, ids: { mal: s.malId } }] : [])
      ]
      return {
        id: s.id,
        title: listed.length ? titles(listed) : (s.malId !== null ? `MAL #${s.malId}` : `Simkl #${s.simklId}`),
        links: listed.length ? sourceLinks(listed) : stored.map(t => ({ label: SOURCE_LABELS[t.source]!, url: itemUrl(t) })),
        traktSeason: s.traktSeason,
        traktSeasonUrl: s.traktSeason !== null && traktLink ? seasonUrl(traktLink, s.traktSeason) : null,
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
      description="How your shows line up across Trakt, Simkl and MAL. Links proven by shared IDs are made for you; everything else waits for your confirm. Every title and episode links to the source."
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
        v-if="data && data.sources.anilist.status !== 'ok'"
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
                  <SourceLinks :links="[{ label: 'Trakt', url: itemUrl(traktTarget(p.trakt)) }]" />
                </div>
                <div class="font-medium">
                  {{ p.trakt.title }}
                </div>
                <div class="text-sm text-muted">
                  <template v-if="p.trakt.onList">
                    next
                    <SourceLinks :links="[{ label: episodeLabel(p.trakt.next), url: p.trakt.next ? episodeUrl(traktTarget(p.trakt), p.trakt.next) : null }]" />
                  </template>
                  <template v-else>
                    not in your Trakt up next
                  </template>
                </div>
              </div>
              <div v-if="entry(p.animeKey)">
                <div class="text-xs text-muted">
                  <SourceLinks :links="sourceLinks(sameAnime(entry(p.animeKey)!.ids))" />
                </div>
                <div class="font-medium">
                  {{ titles(sameAnime(entry(p.animeKey)!.ids)) }}
                </div>
                <div class="text-sm text-muted">
                  <span
                    v-for="(g, i) in nextGroups(sameAnime(entry(p.animeKey)!.ids))"
                    :key="g.label"
                  >{{ i ? ' · ' : '' }}next {{ g.label }} on <SourceLinks :links="g.links" /></span>
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
                Season {{ p.chain.length }} on AniList:
                <template
                  v-for="(c, i) in p.chain"
                  :key="c.malId"
                >
                  <span v-if="i"> → </span>
                  <SourceLinks :links="[{ label: c.title, url: itemUrl({ source: 'mal', kind: 'anime', ids: { mal: c.malId } }) }]" />
                </template>
              </span>
            </div>

            <div class="flex flex-wrap items-end gap-3">
              <UFormField label="Trakt season">
                <TraktSeasonSelect
                  v-model="edits[p.animeKey]!.traktSeason"
                  :trakt-id="p.trakt.trakt"
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
                <SourceLinks :links="[meaning(p)!.trakt]" />
                =
                <SourceLinks :links="meaning(p)!.anime" />
                <UBadge
                  v-if="!p.placement.fromProgress"
                  label="check this"
                  color="warning"
                  variant="subtle"
                  class="ms-1"
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

      <section
        v-if="unlinked.length"
        class="space-y-3"
      >
        <h2 class="text-lg font-semibold">
          Not linked to Trakt
          <UBadge
            :label="String(unlinked.length)"
            color="neutral"
            variant="subtle"
          />
        </h2>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <ul class="divide-y divide-default">
            <li
              v-for="u in unlinked"
              :key="u.key"
              class="flex flex-wrap items-center gap-2 px-4 py-3"
            >
              <span class="font-medium">{{ u.title }}</span>
              <span class="text-sm text-muted">on <SourceLinks :links="u.links" /></span>
              <UBadge
                v-if="u.format && u.format !== 'tv'"
                :label="u.format"
                color="neutral"
                variant="subtle"
              />
              <UButton
                label="Link to Trakt"
                icon="i-lucide-search"
                size="xs"
                variant="soft"
                class="ms-auto"
                @click="linking = { animeKey: u.key, title: u.title, query: u.query }"
              />
            </li>
          </ul>
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
                <span class="font-medium">
                  <SourceLinks
                    v-if="m.trakt"
                    :links="[{ label: m.trakt.title, url: m.trakt.url }]"
                  />
                  <SourceLinks
                    v-else-if="m.simklShow"
                    :links="[{ label: m.simklShow.title, url: m.simklShow.url }]"
                  />
                  <span v-else>Not on Trakt</span>
                </span>
                <UBadge
                  :label="m.status === 'confirmed' ? 'confirmed' : 'by ID'"
                  :color="m.status === 'confirmed' ? 'success' : 'neutral'"
                  variant="subtle"
                />
                <span
                  v-if="m.simklShow && m.trakt"
                  class="text-sm text-muted"
                >Simkl: <SourceLinks :links="[{ label: m.simklShow.title, url: m.simklShow.url }]" /></span>
              </div>
              <div
                v-for="s in m.seasons"
                :key="s.id"
                class="text-sm text-muted"
              >
                <SourceLinks
                  v-if="s.traktSeason !== null"
                  :links="[{ label: `Trakt S${s.traktSeason}`, url: s.traktSeasonUrl }]"
                />
                <span v-else>Not placed in a Trakt season</span>
                = {{ s.title }} on <SourceLinks :links="s.links" />
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

    <LinkToTraktModal
      v-if="linking"
      v-model:open="linkOpen"
      :anime-key="linking.animeKey"
      :anime-title="linking.title"
      :default-query="linking.query"
      @linked="refresh()"
    />
  </UContainer>
</template>
