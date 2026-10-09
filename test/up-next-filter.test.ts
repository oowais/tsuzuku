import { describe, expect, it } from 'vitest'
import { filterQuery, matchesFilter, parseFilter, type FilterableRow, type UpNextFilter } from '../shared/utils/up-next-filter'

const row = (over: Partial<FilterableRow> = {}): FilterableRow => ({
  title: 'Frieren: Beyond Journey\'s End',
  kind: 'anime',
  differs: false,
  accepted: false,
  hasNext: true,
  cells: {
    trakt: { state: 'in_sync', entry: { title: 'Frieren: Beyond Journey\'s End', altTitles: [] } },
    mal: { state: 'in_sync', entry: { title: 'Sousou no Frieren', altTitles: ['葬送のフリーレン', 'Frieren at the Funeral'] } },
    simkl: { state: 'unmapped', entry: null }
  },
  ...over
})
const f = (over: Partial<UpNextFilter> = {}): UpNextFilter => ({ q: '', kind: null, only: [], ...over })

describe('up next filter', () => {
  it('searches every source title, ignoring case and accents, word by word', () => {
    expect(matchesFilter(row(), f({ q: 'sousou' }))).toBe(true)
    expect(matchesFilter(row(), f({ q: '葬送' }))).toBe(true)
    expect(matchesFilter(row(), f({ q: 'funeral frieren' }))).toBe(true)
    expect(matchesFilter(row(), f({ q: 'funeral naruto' }))).toBe(false)
    expect(matchesFilter(row({ title: 'Pokémon' }), f({ q: 'POKEMON' }))).toBe(true)
  })

  it('finds the linked title of a show that is not on that source\'s list', () => {
    const r = row({ title: 'X', cells: { trakt: { state: 'not_in_list', entry: null, ref: { title: 'Severance' } } } })
    expect(matchesFilter(r, f({ q: 'sever' }))).toBe(true)
  })

  it('applies every chip together, and counts an accepted difference as not differing', () => {
    expect(matchesFilter(row(), f({ kind: 'show' }))).toBe(false)
    expect(matchesFilter(row(), f({ only: ['unmapped', 'next'] }))).toBe(true)
    expect(matchesFilter(row({ differs: true }), f({ only: ['differs'] }))).toBe(true)
    expect(matchesFilter(row({ differs: true, accepted: true }), f({ only: ['differs'] }))).toBe(false)
    expect(matchesFilter(row({ hasNext: false }), f({ only: ['next'] }))).toBe(false)
    expect(matchesFilter(row({ cells: {} }), f({ only: ['unmapped'] }))).toBe(false)
  })

  it('round-trips through the URL query and ignores junk', () => {
    const state = f({ q: 'frieren', kind: 'anime', only: ['next', 'differs'] })
    expect(filterQuery(state)).toEqual({ q: 'frieren', kind: 'anime', only: 'differs,next' })
    expect(parseFilter(filterQuery(state))).toEqual({ ...state, only: ['differs', 'next'] })
    expect(parseFilter({ kind: 'movie', only: 'bogus,unmapped', q: ['a', 'b'] })).toEqual(f({ q: 'a', only: ['unmapped'] }))
    expect(filterQuery(f({ q: '  ' }))).toEqual({})
  })
})
