<script setup>
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    // Browser and installed-app chrome follows the page background (Nuxt UI: white, dark slate-900).
    { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
    { name: 'theme-color', content: '#0f172a', media: '(prefers-color-scheme: dark)' },
    { name: 'apple-mobile-web-app-title', content: 'Tsuzuku' }
  ],
  // The ICO is the fallback for browsers without SVG icons; iOS uses the touch icon for home screen shortcuts.
  // The manifest makes the app installable (no service worker: Up Next is always read live). Browsers fetch it
  // without cookies by default, which Cloudflare Access would answer with its login page; `use-credentials`
  // sends the Access cookie.
  link: [
    { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
    { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    { rel: 'manifest', href: '/manifest.webmanifest', crossorigin: 'use-credentials' }
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
