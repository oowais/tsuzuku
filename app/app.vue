<script setup>
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'Tsuzuku'
const description = 'What to watch next across Trakt, Simkl and MyAnimeList.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description
})
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink
          to="/"
          class="focus-visible:outline-3 outline-primary/25 rounded-md p-1 -ms-1"
        >
          <AppLogo class="w-auto h-6 shrink-0" />
        </NuxtLink>
      </template>

      <template #right>
        <UButton
          to="/"
          icon="i-lucide-list-video"
          label="Up Next"
          color="neutral"
          variant="ghost"
        />

        <UButton
          to="/mappings"
          icon="i-lucide-link"
          label="Mappings"
          color="neutral"
          variant="ghost"
        />

        <UButton
          to="/log"
          icon="i-lucide-scroll-text"
          label="Log"
          color="neutral"
          variant="ghost"
        />

        <UButton
          to="/settings"
          icon="i-lucide-settings"
          label="Settings"
          color="neutral"
          variant="ghost"
        />

        <UColorModeButton />
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Tsuzuku · data from Trakt, Simkl, MyAnimeList and AniList
        </p>
      </template>
    </UFooter>
  </UApp>
</template>
