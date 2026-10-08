<script setup lang="ts">
// Picks a season of a Trakt show, listing Trakt's own seasons with episode counts.
const props = defineProps<{ traktId: number }>()
const model = defineModel<number | null>({ required: true })

const { data, status } = await useFetch('/api/trakt/seasons', { query: computed(() => ({ show: props.traktId })), lazy: true })

// USelect uses undefined for "nothing picked"; the rest of the app uses null.
const selected = computed({
  get: () => model.value ?? undefined,
  set: (v: number | undefined) => {
    model.value = v ?? null
  }
})

const items = computed(() => (data.value?.data ?? []).map(s => ({
  value: s.number,
  label: `S${s.number}${s.title && s.title !== `Season ${s.number}` ? ` · ${s.title}` : ''}${s.episodeCount !== null ? ` · ${s.episodeCount} eps` : ''}`
})))
</script>

<template>
  <USelect
    v-model="selected"
    :items="items"
    :loading="status === 'pending'"
    placeholder="Season"
    class="w-56"
  />
</template>
