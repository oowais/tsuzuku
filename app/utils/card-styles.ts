// Looks for the Shows cards, picked in Settings. Same content in each; only the layout and the progress
// display change. Colours come from the theme variables, so every style works with every theme.
export const CARD_STYLES = [
  {
    id: "backdrop",
    label: "Poster backdrop",
    description: "The poster, blurred, behind the card. Big title, one block per episode.",
  },
  {
    id: "board",
    label: "Departure board",
    description: "Dotted texture, dot-matrix episode codes, a glowing track.",
  },
  {
    id: "ticket",
    label: "Ticket",
    description: "A stub with the next episode and a progress ring.",
  },
] as const;

export type CardStyleId = (typeof CARD_STYLES)[number]["id"];

// The chosen style, kept in a cookie so the server renders the cards in it. Poster backdrop by default, also
// for a cookie naming a style that is gone (Simple, Episode segments: removed).
export function useCardStyle() {
  const id = useCookie<string>("tsuzuku-card-style", {
    default: () => "backdrop",
    maxAge: 60 * 60 * 24 * 365 * 5,
    sameSite: "lax",
  });
  const style = computed<CardStyleId>(
    () => CARD_STYLES.find((s) => s.id === id.value)?.id ?? "backdrop",
  );
  return { id, style };
}

// Up Next's layout, picked in Settings: a plain grid, or the first card of Next to watch (the show watched most
// recently, Trakt's order) as a hero tile two columns wide. A cookie too, so the server renders it.
export const UP_NEXT_LAYOUTS = [
  { value: "grid", label: "Grid", icon: "i-lucide-layout-grid" },
  { value: "hero", label: "Hero", icon: "i-lucide-layout-dashboard" },
] as const;
export function useUpNextLayout() {
  const id = useCookie<string>("tsuzuku-up-next-layout", {
    default: () => "grid",
    maxAge: 60 * 60 * 24 * 365 * 5,
    sameSite: "lax",
  });
  const hero = computed(() => id.value === "hero");
  return { id, hero };
}
