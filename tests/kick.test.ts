import { describe, expect, it } from 'vitest'
import { normalize } from '../src/main/platforms/kick/normalize'

const none = new Map()

describe('kick normalize', () => {
  it('reads chat messages with emotes and badges', () => {
    const r = normalize('App\\Events\\ChatMessageEvent', {
      id: 'k1', content: 'hi [emote:1:GG]', type: 'message', created_at: '2026-01-01T00:00:00Z',
      sender: { id: 5, username: 'Zed', slug: 'zed', identity: { color: '#fff', badges: [{ type: 'moderator', text: 'Moderator' }] } }
    }, none)
    expect(r.message).toMatchObject({ id: 'k1', author: { id: '5', isMod: true } })
    expect(r.message?.parts[1]).toMatchObject({ type: 'emote', name: 'GG' })
  })
  it('shows selected image badges', () => {
    const r = normalize('App\\Events\\ChatMessageEvent', {
      id: 'k3', content: 'x', sender: { id: 5, username: 'Z', identity: { badges_v2: [
        { name: 'level', image_url: 'https://x/1.png', selected: true }, { name: 'gold', image_url: 'https://x/2.png', selected: false }
      ] } }
    }, none)
    expect(r.message?.author.badges).toEqual([{ id: 'level', title: 'level', url: 'https://x/1.png' }])
  })
  it('reads replies', () => {
    const r = normalize('App\\Events\\ChatMessageEvent', {
      id: 'k2', content: 'yo', type: 'reply', sender: { id: 5, username: 'Zed' },
      metadata: { original_sender: { username: 'Amy' }, original_message: { content: 'hello' } }
    }, none)
    expect(r.message?.reply).toEqual({ author: 'Amy', text: 'hello' })
  })
  it('survives missing fields, since payloads are unofficial', () => {
    expect(normalize('App\\Events\\ChatMessageEvent', {}, none)).toEqual({})
    expect(normalize('App\\Events\\GiftedSubscriptionsEvent', {}, none).event?.text).toBe('gifted 0 subs')
    expect(normalize('App\\Events\\SomethingNew', { a: 1 }, none)).toEqual({})
  })
  it('reports bans, deletions and gifts', () => {
    expect(normalize('App\\Events\\MessageDeletedEvent', { message: { id: 'x' } }, none).deleted).toBe('x')
    expect(normalize('App\\Events\\UserBannedEvent', { user: { id: 9, username: 'b' }, banned_by: { username: 'm' }, permanent: true }, none)).toMatchObject({ purgedUser: '9', event: { text: 'banned b' } })
    expect(normalize('App\\Events\\GiftedSubscriptionsEvent', { gifter_username: 'g', gifted_usernames: ['a', 'b'] }, none).event).toMatchObject({ actor: 'g', text: 'gifted 2 subs' })
  })
})
