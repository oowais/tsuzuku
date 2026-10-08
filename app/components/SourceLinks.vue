<script setup lang="ts">
// "Simkl + MAL": each name links to that source's page (decision #24). One name when only one source lists it.
defineProps<{ links: { label: string, url: string | null }[] }>()
</script>

<template>
  <span>
    <template
      v-for="(l, i) in links"
      :key="l.label"
    >
      <span v-if="i"> + </span>
      <ULink
        v-if="l.url"
        :to="l.url"
        target="_blank"
        external
        class="underline decoration-dotted underline-offset-2 hover:text-highlighted"
      >{{ l.label }}</ULink>
      <span v-else>{{ l.label }}</span>
    </template>
  </span>
</template>
