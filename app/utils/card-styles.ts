// Looks for the Progress cards, picked in Settings. Same content in each; only the layout and the progress
// display change. Colours come from the theme variables, so every style works with every theme.
export const CARD_STYLES = [
  { id: 'simple', label: 'Simple', description: 'Chips for the next episode, a plain progress bar.' },
  { id: 'board', label: 'Departure board', description: 'Dotted texture, dot-matrix episode codes, a glowing track.' },
  { id: 'backdrop', label: 'Poster backdrop', description: 'The poster, blurred, behind the card. Big title.' },
  { id: 'segments', label: 'Episode segments', description: 'One block per episode, the next one glowing.' },
  { id: 'ticket', label: 'Ticket', description: 'A stub with the next episode and a progress ring.' }
] as const

export type CardStyleId = typeof CARD_STYLES[number]['id']

// The chosen style, kept in a cookie so the server renders the cards in it.
export function useCardStyle() {
  const id = useCookie<string>('tsuzuku-card-style', { default: () => 'simple', maxAge: 60 * 60 * 24 * 365 * 5, sameSite: 'lax' })
  const style = computed<CardStyleId>(() => CARD_STYLES.find(s => s.id === id.value)?.id ?? 'simple')
  return { id, style }
}
