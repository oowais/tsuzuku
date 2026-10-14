// Themes picked in Settings. Each is a set of Nuxt UI colour variables for light and dark mode in main.css
// (`html[data-theme=…]`) plus a font. Colours come from each theme's official palette (kanagawa.nvim, rose-pine,
// catppuccin/palette, tokyonight.nvim, gruvbox, nordtheme, everforest), checked 2026-10-11; Kanagawa's light
// mode is its Lotus variant, Tokyo Night's is Day. Accents that fall under 4.5:1 are adjusted in main.css.
// Glass is Apple's system colours with Liquid Glass on the floating layer (tab bar, menus, dialogs). Solid Glass
// follows deeplethe/solid-glass (MIT): its tokens and rules, mapped onto Nuxt UI's variables and the surfaces.
export interface Theme {
  id: string;
  label: string;
  description: string;
  // Page backgrounds, for the browser's theme-color.
  bg: { light: string; dark: string };
  // Background, text, accent and a second colour, for the swatches in Settings (dark mode).
  swatches: string[];
}

export const THEMES: Theme[] = [
  {
    id: "default",
    label: "Default",
    description: "Nuxt green on slate, Public Sans.",
    bg: { light: "#ffffff", dark: "#0f172a" },
    swatches: ["#0f172a", "#e2e8f0", "#00dc82", "#94a3b8"],
  },
  {
    id: "kanagawa-dragon",
    label: "Kanagawa Dragon",
    description: "Warm charcoal, muted clay red. Lexend.",
    bg: { light: "#f2ecbc", dark: "#181616" },
    swatches: ["#181616", "#c5c9c5", "#c67a74", "#c4b28a"],
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    description: "Deep plum, dusty rose. Outfit.",
    bg: { light: "#faf4ed", dark: "#191724" },
    swatches: ["#191724", "#e0def4", "#ebbcba", "#9ccfd8"],
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    description: "Pastel mauve, rounder corners. Nunito.",
    bg: { light: "#eff1f5", dark: "#1e1e2e" },
    swatches: ["#1e1e2e", "#cdd6f4", "#cba6f7", "#fab387"],
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    description: "Night-city navy, bright blue. Inter.",
    bg: { light: "#e1e2e7", dark: "#1a1b26" },
    swatches: ["#1a1b26", "#c0caf5", "#7aa2f7", "#bb9af7"],
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    description: "Retro brown, warm orange. IBM Plex Sans.",
    bg: { light: "#fbf1c7", dark: "#282828" },
    swatches: ["#282828", "#ebdbb2", "#fe8019", "#fabd2f"],
  },
  {
    id: "nord",
    label: "Nord",
    description: "Arctic grey-blue, frost cyan. Manrope.",
    bg: { light: "#eceff4", dark: "#2e3440" },
    swatches: ["#2e3440", "#eceff4", "#88c0d0", "#5e81ac"],
  },
  {
    id: "everforest",
    label: "Everforest",
    description: "Forest green-grey, soft green. Karla.",
    bg: { light: "#fdf6e3", dark: "#2d353b" },
    swatches: ["#2d353b", "#d3c6aa", "#a7c080", "#83c092"],
  },
  {
    id: "glass",
    label: "Glass",
    description:
      "Apple's Liquid Glass: frosted tab bar and menus over solid content. SF on Apple, Inter elsewhere.",
    bg: { light: "#f2f2f7", dark: "#000000" },
    swatches: ["#000000", "#f2f2f7", "#0a84ff", "#1c1c1e"],
  },
  {
    id: "frosted",
    label: "Frosted",
    description:
      "Plain glassmorphism: frosted tab bar and menus over solid content, indigo. Inter.",
    bg: { light: "#f4f5f7", dark: "#0e1015" },
    swatches: ["#0e1015", "#e5e7eb", "#818cf8", "#1a1d24"],
  },
  {
    id: "solid-glass",
    label: "Solid Glass",
    description:
      "Thick smoky glass after deeplethe/solid-glass: lit top edges, hairlines, ink buttons, no accent hue. Geist.",
    bg: { light: "#e5e8ee", dark: "#121212" },
    swatches: ["#121212", "#f9f9f9", "#ececec", "#3a3a3a"],
  },
  {
    id: "monochrome",
    label: "Monochrome",
    description: "Black and white, no accent. Geist.",
    bg: { light: "#ffffff", dark: "#000000" },
    swatches: ["#000000", "#ededed", "#737373", "#262626"],
  },
];

const DEFAULT = THEMES[0]!;

// The chosen theme, kept in a cookie so the server renders the page in it (no flash of the default).
export function useTheme() {
  const id = useCookie<string>("tsuzuku-theme", {
    default: () => DEFAULT.id,
    maxAge: 60 * 60 * 24 * 365 * 5,
    sameSite: "lax",
  });
  // Glass 1 and Glass 2 were merged into Glass (2026-10-12): a saved pick of either moves to it.
  if (/^glass-\d$/.test(id.value)) id.value = "glass";
  const theme = computed(() => THEMES.find((t) => t.id === id.value) ?? DEFAULT);
  return { id, theme };
}
