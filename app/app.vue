<script setup lang="ts">
const { theme } = useTheme();

useHead({
  meta: [
    { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    // Browser and installed-app chrome follows the page background of the theme picked in Settings.
    {
      name: "theme-color",
      content: () => theme.value.bg.light,
      media: "(prefers-color-scheme: light)",
    },
    {
      name: "theme-color",
      content: () => theme.value.bg.dark,
      media: "(prefers-color-scheme: dark)",
    },
    { name: "apple-mobile-web-app-title", content: "Tsuzuku" },
  ],
  // The ICO is the fallback for browsers without SVG icons; iOS uses the touch icon for home screen shortcuts.
  // The manifest makes the app installable (no service worker: Up Next is always read live). Browsers fetch it
  // without cookies by default, which Cloudflare Access would answer with its login page; `use-credentials`
  // sends the Access cookie.
  link: [
    { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
    { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    { rel: "manifest", href: "/manifest.webmanifest", crossorigin: "use-credentials" },
  ],
  htmlAttrs: {
    lang: "en",
    "data-theme": () => theme.value.id,
  },
});

const title = "Tsuzuku";
const description = "What to watch next across Trakt, Simkl and MyAnimeList.";

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
});
</script>

<template>
  <UApp>
    <!-- A bar along the top once a page change or Up Next's reload takes over 200 ms (`throttle`). -->
    <NuxtLoadingIndicator color="var(--ui-primary)" :height="3" :throttle="200" />
    <!-- No header: the bottom bar is the way around, and phones need the height. -->
    <UMain class="pt-[env(safe-area-inset-top)]">
      <NuxtPage />
    </UMain>

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">Tsuzuku · data from Trakt, Simkl, MyAnimeList and AniList</p>
      </template>
    </UFooter>

    <!-- Room for the bottom bar, so it never covers the end of the page. -->
    <div
      class="h-[calc(4rem+env(safe-area-inset-bottom))] sm:h-[calc(8rem+env(safe-area-inset-bottom))]"
    />
    <AppTabBar />
  </UApp>
</template>
