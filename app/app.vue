<script setup lang="ts">
const { theme } = useTheme()

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
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
  { label: 'Progress', icon: 'i-lucide-list-video', to: '/' },
  { label: 'Calendar', icon: 'i-lucide-calendar-days', to: '/calendar' },
  { label: 'Stats', icon: 'i-lucide-chart-column', to: '/stats' },
  { label: 'Log', icon: 'i-lucide-scroll-text', to: '/log' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' }
]

// The bottom bar on every screen size, so every page is a thumb's tap away; there is no header
// (light or dark is in Settings). Full width on phones, a floating bar of its own width on wider screens.
const route = useRoute()
// Mappings is reached from Settings, so it lights Settings.
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to) || (to === '/settings' && route.path.startsWith('/mappings')))

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
    <!-- A bar along the top once a page change or Up Next's reload takes over 200 ms (`throttle`). -->
    <NuxtLoadingIndicator
      color="var(--ui-primary)"
      :height="3"
      :throttle="200"
    />
    <!-- No header: the bottom bar is the way around, and phones need the height. -->
    <UMain class="pt-[env(safe-area-inset-top)]">
      <NuxtPage />
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Tsuzuku · data from Trakt, Simkl, MyAnimeList and AniList
        </p>
      </template>
    </UFooter>

    <!-- Room for the bottom bar, so it never covers the end of the page. -->
    <div class="h-[calc(4rem+env(safe-area-inset-bottom))] sm:h-[calc(6rem+env(safe-area-inset-bottom))]" />
    <nav
      aria-label="Main"
      class="fixed inset-x-0 bottom-0 z-50 sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4 pointer-events-none"
    >
      <ul class="pointer-events-auto mx-auto grid grid-cols-5 pb-[env(safe-area-inset-bottom)] sm:pb-0 border-t border-default bg-default/95 backdrop-blur sm:max-w-lg sm:rounded-2xl sm:border sm:shadow-lg">
        <li
          v-for="item in nav"
          :key="item.to"
        >
          <NuxtLink
            :to="item.to"
            :aria-current="isActive(item.to) ? 'page' : undefined"
            class="flex h-16 flex-col items-center justify-center gap-1 text-[11px] leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            :class="isActive(item.to) ? 'text-primary font-medium' : 'text-muted hover:text-default'"
          >
            <span
              class="flex h-7 w-12 items-center justify-center rounded-full transition-colors"
              :class="isActive(item.to) ? 'bg-primary/15' : ''"
            >
              <UIcon
                :name="item.icon"
                class="size-5"
              />
            </span>
            {{ item.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </UApp>
</template>
