import { describe, expect, it } from 'vitest'
import { formatLabel, isSideStory } from '../shared/utils/formats'

describe('formats', () => {
  it('knows specials, OVAs and movies, in any case', () => {
    expect(['ova', 'OVA', 'special', 'movie', 'tv_special'].every(isSideStory)).toBe(true)
    expect([null, undefined, '', 'tv', 'ona'].some(isSideStory)).toBe(false)
  })

  it('labels the sources\' types and keeps unknown ones as written', () => {
    expect(['ova', 'tv_special', 'movie', 'ona'].map(formatLabel)).toEqual(['OVA', 'TV special', 'Movie', 'ONA'])
    expect(formatLabel('light_novel')).toBe('light_novel')
  })
})
