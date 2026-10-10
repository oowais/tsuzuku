import { describe, expect, it } from 'vitest'
import { sequelsForShow, type ComingBackSequel } from '../app/composables/useComingBack'

const sequel = (title: string, from: string, extra: Partial<ComingBackSequel> = {}): ComingBackSequel => ({
  malId: 1, anilistId: 2, title, format: 'TV', stage: 'airing', startDate: { year: 2026, month: 10, day: 1 }, nextEpisode: null,
  from: { malId: 3, title: from }, onPlanToWatch: false, cover: null, dismissed: false, ...extra
})

describe('Coming back sequels for an Up Next show', () => {
  it('matches the season it follows or the sequel by title, ignoring case, punctuation and season numbers', () => {
    const detective = sequel('The Detective Is Already Dead Season 2', 'The Detective Is Already Dead')
    const slime = sequel('Tensei Shitara Slime Datta Ken 4th Season', 'That Time I Got Reincarnated as a Slime Season 3')
    expect(sequelsForShow('The Detective Is Already Dead', [detective, slime])).toEqual([detective])
    expect(sequelsForShow('the detective is already dead!', [detective])).toEqual([detective])
    expect(sequelsForShow('That Time I Got Reincarnated as a Slime', [slime])).toEqual([slime])
  })

  it('offers nothing for another show, an empty title, or a dismissed sequel', () => {
    const s = sequel('Witch Watch 2nd Season', 'WITCH WATCH')
    expect(sequelsForShow('Witch Hat Atelier', [s])).toEqual([])
    expect(sequelsForShow('', [s])).toEqual([])
    expect(sequelsForShow('Witch Watch', [{ ...s, dismissed: true }])).toEqual([])
    expect(sequelsForShow('Witch Watch', [s])).toEqual([s])
  })
})
