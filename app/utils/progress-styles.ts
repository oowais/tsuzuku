// How a Shows card shows progress, picked in Settings. Every card is drawn the same (the poster behind it); only
// this changes. Under the card unless said otherwise. Colours come from the theme variables, so each works with
// every theme.
export const PROGRESS_STYLES = [
  {
    id: "segments",
    label: "Episode segments",
    description: "One block per episode under the card, the next one glowing.",
    icon: "i-lucide-grip-horizontal",
  },
  {
    id: "gauge",
    label: "Half gauge",
    description: "A half ring over Mark watched, the count beside it.",
    icon: "i-lucide-gauge",
  },
  {
    id: "vertical",
    label: "Vertical bar",
    description: "Beside the poster, filling up.",
    icon: "i-lucide-chart-no-axes-column",
  },
  {
    id: "aired",
    label: "Aired vs upcoming",
    description: "Watched, then whether the next episode is out yet.",
    icon: "i-lucide-calendar-clock",
  },
  {
    id: "number",
    label: "Big number",
    description: "The count leads, a thin bar under it.",
    icon: "i-lucide-hash",
  },
  {
    id: "edge",
    label: "Edge fills",
    description: "The card's right edge fills up, opposite the status edge.",
    icon: "i-lucide-panel-right",
  },
  {
    id: "poster",
    label: "Poster fills with colour",
    description: "The poster in grey above how far you are.",
    icon: "i-lucide-image",
  },
] as const;

export type ProgressStyleId = (typeof PROGRESS_STYLES)[number]["id"];

// The chosen style, kept in a cookie so the server renders the cards in it. Episode segments by default, also for
// a cookie naming a style that is gone.
export function useProgressStyle() {
  const id = useCookie<string>("tsuzuku-progress-style", {
    default: () => "segments",
    maxAge: 60 * 60 * 24 * 365 * 5,
    sameSite: "lax",
  });
  const style = computed<ProgressStyleId>(
    () => PROGRESS_STYLES.find((s) => s.id === id.value)?.id ?? "segments",
  );
  return { id, style };
}
