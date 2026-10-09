<script setup lang="ts">
// A source's logo at text size, in its brand colour (SOURCE_ICONS). Nothing for a source without one.
const props = defineProps<{ source: string }>()
const icon = computed(() => SOURCE_ICONS[props.source])
</script>

<template>
  <UIcon
    v-if="icon"
    :name="icon.icon"
    class="size-[1.1em] shrink-0 align-[-0.15em]"
    :class="icon.class"
    aria-hidden="true"
  />
</template>
