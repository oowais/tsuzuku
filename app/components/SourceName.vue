<script setup lang="ts">
// A source's logo and name, e.g. Trakt with its logo. `label` overrides the short name. Plain inline (not
// flex), so it sits on the text baseline inside a sentence.
const props = defineProps<{ source: string, label?: string }>()
</script>

<template>
  <span class="whitespace-nowrap">
    <SourceIcon
      :source="props.source"
      class="me-1"
    />{{ props.label ?? SOURCE_LABELS[props.source] ?? props.source }}
  </span>
</template>
