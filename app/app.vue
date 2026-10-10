<script setup lang="ts">
const { theme } = useTheme()

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    // Browser and installed-app chrome follows the page background of the theme picked in Settings.
    { name: 'theme-color', content: () => theme.value.bg.light, media: '(prefers-color-scheme: light)' },
    { name: 'theme-color', content: () => theme.value.bg.dark, media: '(prefers-color-scheme: dark)' },
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
    'lang': 'en',
    'data-theme': () => theme.value.id
  }
})

const nav = [
  { label: 'Up Next', icon: 'i-lucide-list-video', to: '/' },
  { label: 'Calendar', icon: 'i-lucide-calendar-days', to: '/calendar' },
  { label: 'Stats', icon: 'i-lucide-chart-column', to: '/stats' },
  { label: 'Mappings', icon: 'i-lucide-link', to: '/mappings' },
  { label: 'Log', icon: 'i-lucide-scroll-text', to: '/log' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' }
]

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

      <!-- Inline on wide screens; behind the header's menu button on phones. -->
      <UNavigationMenu
        :items="nav"
        variant="link"
      />

      <template #right>
        <UColorModeButton />
      </template>

      <template #body>
        <!-- Phone menu: large touch targets. -->
        <UNavigationMenu
          :items="nav"
          orientation="vertical"
          class="-mx-2.5"
          :ui="{ list: 'space-y-2', link: 'py-3.5 px-3 text-lg gap-3', linkLeadingIcon: 'size-6' }"
        />
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
