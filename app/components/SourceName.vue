<script setup lang="ts">
// A source's logo and name, e.g. Trakt with its logo. `label` overrides the short name.
const props = defineProps<{ source: string, label?: string }>()
</script>

<template>
  <span class="inline-flex items-center gap-1 whitespace-nowrap">
    <SourceIcon :source="props.source" />
    {{ props.label ?? SOURCE_LABELS[props.source] ?? props.source }}
  </span>
</template>
