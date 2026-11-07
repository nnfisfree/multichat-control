import { describe, expect, it } from 'vitest'
import { formatPronoun } from '../src/main/pronouns'

const defs = {
  hehim: { name: 'hehim', subject: 'He', object: 'Him', singular: false },
  theythem: { name: 'theythem', subject: 'They', object: 'Them', singular: false },
  any: { name: 'any', subject: 'Any', object: 'Any', singular: true }
}

describe('formatPronoun', () => {
  it('formats paired, single and alternate pronouns', () => {
    expect(formatPronoun(defs, 'hehim')).toBe('He/Him')
    expect(formatPronoun(defs, 'any')).toBe('Any')
    expect(formatPronoun(defs, 'hehim', 'theythem')).toBe('He/They')
  })
  it('returns nothing for unknown or unset ids', () => {
    expect(formatPronoun(defs, null)).toBeNull()
    expect(formatPronoun(defs, 'nope')).toBeNull()
  })
})
