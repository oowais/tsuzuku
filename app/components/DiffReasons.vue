<script setup lang="ts">
import type { DiffReason } from '#shared/utils/diff-reasons'

// The "Why?" lines of a differing card (#78): likely causes, most specific first, each with the normal flow
// that fixes it. Only hints; nothing is changed from here.
type Source = 'trakt' | 'simkl' | 'mal'
defineProps<{ reasons: DiffReason[] }>()
const emit = defineEmits<{ mark: [source: Source] }>()

// "3 Oct" in the viewer's time zone (rendered in the browser only).
const day = (at: string) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
</script>

<template>
  <div class="space-y-1 text-sm">
    <div
      v-for="(r, i) in reasons"
      :key="i"
      class="grid grid-cols-[1rem_1fr] gap-x-1.5"
    >
      <UIcon
        :name="i === 0 ? 'i-lucide-lightbulb' : 'i-lucide-dot'"
        class="mt-0.5 size-4 text-muted"
      />
      <p class="min-w-0 leading-snug">
        <template v-if="r.kind === 'partial_mark'">
          <ClientOnly>{{ day(r.at) }}</ClientOnly> mark went to
          <template
            v-for="(s, j) in r.reached"
            :key="s"
          >
            <SourceName :source="s" />{{ j < r.reached.length - 1 ? ',' : '' }}
          </template>
          only; <SourceName :source="r.behind" /> is 1 behind.
          <UButton
            :label="`Mark on ${SOURCE_LABELS[r.behind]}`"
            variant="link"
            size="xs"
            class="p-0"
            @click="emit('mark', r.behind)"
          />
        </template>

        <template v-else-if="r.kind === 'offset'">
          <SourceName :source="r.source" /> lines up with offset {{ r.suggested }}, not {{ r.current }}
          <span class="text-muted">({{ r.suggested ? `${r.suggested} episodes in the seasons before it` : `the entry starts Trakt S${r.traktSeason}` }}).</span>
          <ULink
            :to="{ path: '/mappings', query: { edit: r.seasonId, offset: r.suggested } }"
            class="text-xs font-medium text-primary"
          >Edit link</ULink>
        </template>

        <template v-else-if="r.kind === 'link'">
          <SourceName source="trakt" /> {{ r.traktEpisode }} is outside the linked <SourceName :source="r.source" /> entry
          ({{ r.episodes }} episodes): the link may be another season.
          <ULink
            :to="{ path: '/mappings', query: { edit: r.seasonId } }"
            class="text-xs font-medium text-primary"
          >Open link</ULink>
        </template>

        <template v-else-if="r.kind === 'not_listed_yet'">
          <SourceName :source="r.source" /> doesn't list {{ r.episode }} yet; <SourceName :source="r.listedBy" /> does.
        </template>

        <template v-else-if="r.kind === 'not_aired'">
          <SourceName :source="r.source" /> already lists {{ r.episode }}, which airs <ClientOnly>{{ relativeTime(r.airsAt) }}</ClientOnly>.
        </template>

        <template v-else-if="r.kind === 'outside'">
          <SourceName :source="r.source" /> is {{ r.by }} ahead of <SourceName :source="r.than" />: watched outside Tsuzuku.
        </template>
      </p>
    </div>
  </div>
</template>
