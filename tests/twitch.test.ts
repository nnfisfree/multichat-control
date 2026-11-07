import { describe, expect, it } from 'vitest'
import { buildEmoteList, smallAvatar } from '../src/main/platforms/twitch/emotes'
import { chatMessage, cheermoteUrl, eventFromSub, hypeTrain, notification } from '../src/main/platforms/twitch/normalize'

const base = {
  chatter_user_id: '1', chatter_user_name: 'Sonny', chatter_user_login: 'sonny', message_id: 'm1', color: '#00FF00',
  badges: [{ set_id: 'moderator', id: '1', info: '' }], message_type: 'text', reply: null,
  message: { text: 'hi Kappa KEKW', fragments: [{ type: 'text', text: 'hi ' }, { type: 'emote', text: 'Kappa', emote: { id: '25', format: ['static'] } }, { type: 'text', text: ' KEKW' }] }
}
const third = new Map([['KEKW', { name: 'KEKW', url: 'bttv' }]])

describe('chatMessage', () => {
  it('keeps native emotes and applies third-party emotes to text fragments', () => {
    const m = chatMessage(base, new Map(), third)
    expect(m.parts.filter((p) => p.type === 'emote').map((p: any) => p.name)).toEqual(['Kappa', 'KEKW'])
    expect(m.author.isMod).toBe(true)
  })
  it('marks first-time chatters and replies', () => {
    const m = chatMessage({ ...base, message_type: 'user_intro', reply: { parent_user_name: 'Bob', parent_message_body: 'yo' } }, new Map(), third)
    expect(m.firstTime).toBe(true)
    expect(m.reply).toEqual({ author: 'Bob', text: 'yo' })
  })
})

describe('GIFs and cheers', () => {
  it('shows GIF fragments as images, using the URL unchanged', () => {
    const url = 'https://media.example/abc.gif?x=1'
    const m = chatMessage({ ...base, message: { text: '[Dancing cat]', fragments: [{ type: 'gif', text: '[Dancing cat]', gif: { id: '1', url } }] } }, new Map(), third)
    expect(m.parts).toEqual([{ type: 'gif', url, alt: 'Dancing cat' }])
  })
  const cheers = new Map([['cheer', [{ minBits: 1, url: 'c1' }, { minBits: 100, url: 'c100' }, { minBits: 1000, url: 'c1000' }]]])
  it('picks the highest cheermote tier reached', () => {
    expect(cheermoteUrl(cheers, 'Cheer', 500)).toBe('c100')
    expect(cheermoteUrl(cheers, 'nope', 500)).toBeUndefined()
  })
  it('highlights cheers and renders their cheermotes', () => {
    const m = chatMessage({ ...base, cheer: { bits: 100 }, message: { text: 'Cheer100 gg', fragments: [{ type: 'cheermote', text: 'Cheer100', cheermote: { prefix: 'cheer', bits: 100, tier: 100 } }, { type: 'text', text: ' gg' }] } }, new Map(), third, cheers)
    expect(m).toMatchObject({ kind: 'cheer', label: '100 BITS' })
    expect(m.parts[0]).toMatchObject({ type: 'emote', url: 'c100' })
  })
  it('marks gigantified emotes', () => {
    expect(chatMessage({ ...base, message_type: 'power_ups_gigantified_emote' }, new Map(), third).effect).toBe('giant')
  })
})

describe('buildEmoteList', () => {
  const self = { id: '1', avatar: 'me.png' }
  const owners = new Map([['2', { name: 'Zed', avatar: 'z.png' }], ['3', { name: 'Amy', avatar: 'a.png' }]])
  const e = (name: string, owner_id = '1') => ({ id: name, name, owner_id, format: ['static'] })
  const list = buildEmoteList(self, [e('mine')], [e('mine'), e('mine2'), e('z1', '2'), e('a1', '3'), e('prime', 'twitch')], [e('global')], owners)

  it('puts your channel first, then channels by name, then the rest', () => {
    expect([...new Set(list.map((x) => x.group))]).toEqual(['My Channel Emotes', 'Amy Emotes', 'Zed Emotes', 'Other Emotes', 'Twitch Global'])
  })
  it('attaches each channel avatar to its group', () => {
    expect(list.find((x) => x.name === 'mine')?.groupIcon).toBe('me.png')
    expect(list.find((x) => x.name === 'a1')?.groupIcon).toBe('a.png')
  })
  it('lists an emote once', () => {
    expect(list.filter((x) => x.name === 'mine')).toHaveLength(1)
  })
  it('asks for small avatars', () => {
    expect(smallAvatar('https://x/a-profile_image-300x300.png')).toBe('https://x/a-profile_image-70x70.png')
  })
})

describe('hypeTrain', () => {
  it('accepts top contributions as one object or a list', () => {
    const e = { level: 3, progress: 100, goal: 200, total: 900, expires_at: '2026-01-01T00:05:00Z', type: 'golden_kappa' }
    const one = { user_name: 'A', type: 'bits', total: 50 }
    expect(hypeTrain({ ...e, top_contributions: one }).top).toHaveLength(1)
    expect(hypeTrain({ ...e, top_contributions: [one, one] }).top).toHaveLength(2)
    expect(hypeTrain({ ...e, top_contributions: [one] })).toMatchObject({ level: 3, type: 'golden_kappa' })
  })
})

describe('notification', () => {
  it('shows announcements in both chat and events', () => {
    const n = notification({ ...base, notice_type: 'announcement', announcement: { color: 'BLUE' } }, new Map(), third)
    expect(n.message?.kind).toBe('announcement')
    expect(n.event?.type).toBe('announcement')
  })
  it('hides the name of anonymous gifters', () => {
    const n = notification({ ...base, notice_type: 'community_sub_gift', chatter_is_anonymous: true, community_sub_gift: { total: 5, sub_tier: '1000' } }, new Map(), third)
    expect(n.event?.actor).toBe('Anonymous')
    expect(n.event?.text).toBe('gifted 5 subs to the community')
    expect(n.event?.big).toBe(true)
  })
  it('collapses a gift bomb into its single summary', () => {
    const one = notification({ ...base, notice_type: 'sub_gift', sub_gift: { community_gift_id: 'g1', recipient_user_name: 'x' } }, new Map(), third)
    expect(one).toEqual({})
    const solo = notification({ ...base, notice_type: 'sub_gift', sub_gift: { community_gift_id: null, recipient_user_name: 'x', sub_tier: '1000' } }, new Map(), third)
    expect(solo.event).toMatchObject({ text: 'gifted a sub to x', amount: 'Tier 1' })
  })
  it('words resubs like the reference design', () => {
    const n = notification({ ...base, notice_type: 'resub', message: { text: 'u deserve' }, resub: { cumulative_months: 5, is_prime: true } }, new Map(), third)
    expect(n.event).toMatchObject({ text: 'resubscribed to the channel (5 months)', amount: 'Prime', message: 'u deserve' })
  })
  it('keeps announcements out of event cards, since they are already chat rows', () => {
    expect(notification({ ...base, notice_type: 'announcement' }, new Map(), third).event?.noChat).toBe(true)
  })
})

describe('eventFromSub', () => {
  const redemption = { id: 'r1', user_name: 'Sonny', user_input: '', status: 'unfulfilled', reward: { id: 'a', title: 'KEKW', cost: 500, prompt: '' } }
  it('keeps the reward name separate so it can be bold', () => {
    expect(eventFromSub('channel.channel_points_custom_reward_redemption.add', 'e', redemption, new Set())).toMatchObject({ text: 'redeemed', subject: 'KEKW', amount: '500' })
  })
  it('offers fulfil and refund only for rewards this app owns', () => {
    const type = 'channel.channel_points_custom_reward_redemption.add'
    expect(eventFromSub(type, 'e', redemption, new Set(['a']))?.actions).toHaveLength(2)
    expect(eventFromSub(type, 'e', redemption, new Set())?.actions).toBeUndefined()
  })
  it('names Power-ups', () => {
    const e = eventFromSub('channel.bits.use', 'e', { type: 'power_up', user_name: 'S', bits: 30, power_up: { type: 'gigantify_an_emote' } }, new Set())
    expect(e).toMatchObject({ type: 'powerup', text: 'used', subject: 'Gigantify an Emote', amount: '30 bits' })
  })
  it('reports timeouts with their length', () => {
    const e = eventFromSub('channel.ban', 'e', { user_name: 'x', moderator_user_name: 'NNF', is_permanent: false, banned_at: '2026-01-01T00:00:00Z', ends_at: '2026-01-01T00:01:00Z' }, new Set())
    expect(e).toMatchObject({ text: 'timed out x', amount: '1m' })
  })
  it('ignores unknown types', () => {
    expect(eventFromSub('channel.unknown', 'e', {}, new Set())).toBeNull()
  })
})
