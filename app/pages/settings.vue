<script setup lang="ts">
// Settings is a panel over the current page now (useSettingsPanel). This route stays for old links and bookmarks: it
// opens the panel over Shows, passing on a sign-in result if there is one.
const route = useRoute();
await navigateTo({ path: "/", query: { ...route.query, settings: null } }, { replace: true });
</script>

<template>
  <div />
</template>
