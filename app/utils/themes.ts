// Themes picked in Settings. Each is a set of Nuxt UI colour variables for light and dark mode in main.css
// (`html[data-theme=…]`) plus a font. Colours come from each theme's official palette (kanagawa.nvim, rose-pine,
// catppuccin/palette), checked 2026-10-10; Kanagawa's light mode is its Lotus variant.
export interface Theme {
  id: string
  label: string
  description: string
  // Page backgrounds, for the browser's theme-color.
  bg: { light: string, dark: string }
  // Background, text, accent and a second colour, for the swatches in Settings (dark mode).
  swatches: string[]
}

export const THEMES: Theme[] = [
  { id: 'default', label: 'Default', description: 'Nuxt green on slate, Public Sans.', bg: { light: '#ffffff', dark: '#0f172a' }, swatches: ['#0f172a', '#e2e8f0', '#00dc82', '#94a3b8'] },
  { id: 'kanagawa-wave', label: 'Kanagawa Wave', description: 'Ink blue-black, parchment text, soft blue. Nunito Sans.', bg: { light: '#f2ecbc', dark: '#1f1f28' }, swatches: ['#1f1f28', '#dcd7ba', '#7e9cd8', '#e6c384'] },
  { id: 'kanagawa-dragon', label: 'Kanagawa Dragon', description: 'Warm charcoal, muted clay red. Lexend.', bg: { light: '#f2ecbc', dark: '#181616' }, swatches: ['#181616', '#c5c9c5', '#c4746e', '#c4b28a'] },
  { id: 'rose-pine', label: 'Rosé Pine', description: 'Deep plum, dusty rose. Outfit.', bg: { light: '#faf4ed', dark: '#191724' }, swatches: ['#191724', '#e0def4', '#ebbcba', '#9ccfd8'] },
  { id: 'catppuccin', label: 'Catppuccin', description: 'Pastel mauve, rounder corners. Nunito.', bg: { light: '#eff1f5', dark: '#1e1e2e' }, swatches: ['#1e1e2e', '#cdd6f4', '#cba6f7', '#fab387'] },
  { id: 'monochrome', label: 'Monochrome', description: 'Black and white, no accent. Geist.', bg: { light: '#ffffff', dark: '#000000' }, swatches: ['#000000', '#ededed', '#737373', '#262626'] }
]

const DEFAULT = THEMES[0]!

// The chosen theme, kept in a cookie so the server renders the page in it (no flash of the default).
export function useTheme() {
  const id = useCookie<string>('tsuzuku-theme', { default: () => DEFAULT.id, maxAge: 60 * 60 * 24 * 365 * 5, sameSite: 'lax' })
  const theme = computed(() => THEMES.find(t => t.id === id.value) ?? DEFAULT)
  return { id, theme }
}
