<script setup lang="ts">
// The bottom bar on every screen size, so every page is a thumb's tap away; there is no header
// (light or dark is in Settings). Full width on phones, a floating bar of its own width on wider screens; a theme
// can float it on phones too (--tabbar-* tokens in main.css). It is a `surface-glass`: plain elevated and lightly
// blurred by default, the theme's glass where it sets one.
const nav = [
  { label: "Shows", icon: "i-lucide-tv", to: "/" },
  { label: "Movies", icon: "i-lucide-clapperboard", to: "/movies" },
  { label: "Calendar", icon: "i-lucide-calendar-days", to: "/calendar" },
  { label: "Stats", icon: "i-lucide-chart-column", to: "/stats" },
  { label: "Log", icon: "i-lucide-scroll-text", to: "/log" },
];
// Settings opens its panel over the current page (useSettingsPanel) and is lit while it is open; Mappings is reached
// from it, so it lights Settings too.
const { open: settingsOpen, openTo: settingsTo } = useSettingsPanel();

const route = useRoute();
const settingsActive = computed(() => settingsOpen.value || route.path.startsWith("/mappings"));
const items = computed(() => [
  ...nav.map((i) => ({
    ...i,
    key: i.to,
    active:
      !settingsActive.value && (i.to === "/" ? route.path === "/" : route.path.startsWith(i.to)),
  })),
  {
    label: "Settings",
    icon: "i-lucide-settings",
    key: "settings",
    to: settingsTo.value,
    active: settingsActive.value,
  },
]);
// Settings again while its panel is open closes it.
function onClick(key: string, e: MouseEvent) {
  if (key !== "settings" || !settingsOpen.value) return;
  e.preventDefault();
  settingsOpen.value = false;
}
</script>

<template>
  <nav
    aria-label="Main"
    class="fixed inset-x-0 bottom-0 z-50 sm:px-4 sm:pt-10 sm:pb-[calc(1rem+env(safe-area-inset-bottom))] sm:bg-linear-to-t sm:from-(--ui-bg) sm:via-(--ui-bg)/85 sm:to-transparent pointer-events-none"
  >
    <ul
      class="tab-bar surface-glass pointer-events-auto relative grid grid-cols-6 border-t shadow-[0_-4px_16px_rgb(0_0_0/0.25)] sm:max-w-lg sm:border-0 sm:ring-1 sm:ring-(--nav-ring) sm:shadow-[0_0_32px_var(--nav-glow),0_10px_40px_8px_var(--nav-shadow)]"
    >
      <li v-for="item in items" :key="item.key">
        <NuxtLink
          :to="item.to"
          :aria-current="item.active ? 'page' : undefined"
          class="flex h-16 flex-col items-center justify-center gap-1 text-[11px] leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          :class="item.active ? 'text-primary font-semibold' : 'text-muted hover:text-default'"
          @click="onClick(item.key, $event)"
        >
          <!-- The current page: a pill in the theme's active colours (by default the solid accent, which holds 4.5:1
               against text-inverted, with the nav's glow), so it reads at a glance in every theme. -->
          <span
            class="pill flex h-8 w-14 items-center justify-center rounded-full"
            :class="
              item.active
                ? 'bg-(--tabbar-active-bg) text-(--tabbar-active-fg) shadow-(--tabbar-active-shadow)'
                : ''
            "
          >
            <UIcon :name="item.icon" class="size-5" />
          </span>
          {{ item.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.tab-bar {
  --surface-bg: var(--ui-bg-elevated);
  --surface-filter: blur(8px);
  --surface-border: var(--ui-border-accented);
  /* The theme's tab bar glass details where it sets them (unset, these fall back to the shared glass ones). */
  --glass-inset: var(--tabbar-glass-inset);
  --glass-rim: var(--tabbar-glass-rim);
  --glass-sheen: var(--tabbar-glass-sheen);
  margin: 0 var(--tabbar-gap) var(--tabbar-gap-bottom);
  padding-bottom: var(--tabbar-safe-pad);
  border-radius: var(--tabbar-radius-mobile);
}
@media (min-width: 640px) {
  .tab-bar {
    margin: 0 auto;
    padding-bottom: 0;
    border-radius: var(--tabbar-radius);
  }
}
.pill {
  transition:
    background-color 150ms,
    color 150ms;
}
</style>
