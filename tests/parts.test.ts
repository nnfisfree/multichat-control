import { describe, expect, it } from 'vitest'
import { composerPlaceholder, linkify, parseKickContent, parseText, plainText, safeUrl, serializeFor, sortEmotes } from '../src/shared/parts'
import type { Emote } from '../src/shared/types'

const lookup = new Map([['KEKW', { name: 'KEKW', url: 'u' }]])

describe('safeUrl', () => {
  it('accepts web links only', () => {
    expect(safeUrl('https://a.com/x')).toBe('https://a.com/x')
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('file:///c:/x')).toBeNull()
  })
})

describe('linkify', () => {
  it('leaves trailing punctuation out of links', () => {
    expect(linkify('see https://a.com/x, ok')).toEqual([
      { type: 'text', text: 'see ' }, { type: 'link', url: 'https://a.com/x', text: 'https://a.com/x' }, { type: 'text', text: ', ok' }
    ])
  })
})

describe('parseText', () => {
  it('replaces whole words with emotes only', () => {
    expect(parseText('lol KEKW notKEKW', lookup).map((p) => p.type)).toEqual(['text', 'emote', 'text'])
  })
  it('round-trips to plain text', () => {
    expect(plainText(parseText('a KEKW b https://a.com', lookup))).toBe('a KEKW b https://a.com')
  })
})

describe('serializeFor', () => {
  const emotes = [{ id: '7', name: 'GG', provider: 'kick' as const }, { id: 'x', name: 'catJAM', provider: '7tv' as const }]
  it('writes the Kick token for native emotes only', () => {
    expect(serializeFor('kick', 'hi GG catJAM', emotes)).toBe('hi [emote:7:GG] catJAM')
  })
  it('leaves other platforms unchanged', () => {
    expect(serializeFor('twitch', 'hi GG', emotes)).toBe('hi GG')
  })
})

describe('parseKickContent', () => {
  it('reads emote tokens among text', () => {
    const parts = parseKickContent('yo [emote:37226:KEKW] nice')
    expect(parts[1]).toEqual({ type: 'emote', name: 'KEKW', url: 'https://files.kick.com/emotes/37226/fullsize' })
    expect(plainText(parts)).toBe('yo KEKW nice')
  })
})

describe('composerPlaceholder', () => {
  it('names one or two platforms and only says all when it means all', () => {
    expect(composerPlaceholder('all', ['twitch'], true)).toBe('Send a message to Twitch...')
    expect(composerPlaceholder('all', ['twitch', 'kick'], true)).toBe('Send a message to Twitch and Kick...')
    expect(composerPlaceholder('all', ['twitch', 'youtube', 'kick'], true)).toBe('Send a message to all platforms...')
  })
  it('explains why nothing can be sent', () => {
    expect(composerPlaceholder('all', [], true)).toBe('No platforms selected')
    expect(composerPlaceholder('all', [], false)).toBe('No platforms connected')
  })
  it('uses the tab on a platform tab', () => {
    expect(composerPlaceholder('kick', ['kick'], true)).toBe('Send a message to Kick...')
  })
})

describe('sortEmotes', () => {
  const e = (name: string, provider: Emote['provider'], platform: Emote['platform']): Emote => ({ id: name, name, provider, platform, group: '', url: '' })
  const list = [e('y', 'emoji', 'youtube'), e('k7', '7tv', 'kick'), e('k', 'kick', 'kick'), e('b', 'bttv', 'twitch'), e('t', 'twitch', 'twitch')]
  it('prioritises Twitch on the All tab', () => {
    expect(sortEmotes(list, 'all').map((x) => x.name)).toEqual(['t', 'b', 'k', 'k7', 'y'])
  })
  it('puts native emotes first on a platform tab', () => {
    expect(sortEmotes([e('k7', '7tv', 'kick'), e('k', 'kick', 'kick')], 'kick').map((x) => x.name)).toEqual(['k', 'k7'])
  })
})
