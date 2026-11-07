import type { ActionDef, ActionResult } from '../../../shared/types'
import type { Helix } from './connector'

const CHAT_MODES: { key: string; label: string; apply: (on: boolean) => Record<string, unknown> }[] = [
  { key: 'slow_mode', label: 'Slow mode', apply: (on) => ({ slow_mode: on, slow_mode_wait_time: on ? 30 : undefined }) },
  { key: 'follower_mode', label: 'Follower-only', apply: (on) => ({ follower_mode: on }) },
  { key: 'subscriber_mode', label: 'Sub-only', apply: (on) => ({ subscriber_mode: on }) },
  { key: 'emote_mode', label: 'Emote-only', apply: (on) => ({ emote_mode: on }) },
  { key: 'unique_chat_mode', label: 'Unique chat', apply: (on) => ({ unique_chat_mode: on }) }
]

export async function buildActions(helix: Helix, id: string): Promise<ActionDef[]> {
  const platform = 'twitch' as const
  const mod = { broadcaster_id: id, moderator_id: id }
  const [settings, shield, rewards, manageable] = await Promise.all([
    helix('GET', '/chat/settings', mod).catch(() => null),
    helix('GET', '/moderation/shield_mode', mod).catch(() => null),
    helix('GET', '/channel_points/custom_rewards', { broadcaster_id: id }).catch(() => null),
    helix('GET', '/channel_points/custom_rewards', { broadcaster_id: id, only_manageable_rewards: 'true' }).catch(() => null)
  ])
  const chat = settings?.data?.[0] ?? {}
  const own = new Set((manageable?.data ?? []).map((r: any) => r.id))

  const actions: ActionDef[] = [
    {
      id: 'announce', platform, group: 'Chat', label: 'Announcement',
      fields: [
        { key: 'message', label: 'Message', type: 'text', required: true },
        { key: 'color', label: 'Colour', type: 'select', default: 'primary', options: ['primary', 'blue', 'green', 'orange', 'purple'].map((v) => ({ value: v, label: v })) }
      ]
    },
    { id: 'shoutout', platform, group: 'Chat', label: 'Shoutout', fields: [{ key: 'login', label: 'Channel name', type: 'text', required: true }] },
    { id: 'clear', platform, group: 'Chat', label: 'Clear chat', confirm: 'Clear chat for everyone?' },
    ...CHAT_MODES.map((m): ActionDef => ({ id: `mode.${m.key}`, platform, group: 'Chat modes', label: m.label, active: !!chat[m.key] })),
    { id: 'shield', platform, group: 'Chat modes', label: 'Shield mode', active: !!shield?.data?.[0]?.is_active },
    { id: 'clip', platform, group: 'Stream', label: 'Create clip', note: 'Only works while live.' },
    {
      id: 'ad', platform, group: 'Stream', label: 'Run ad', confirm: 'Start an ad break now?',
      fields: [{ key: 'length', label: 'Length', type: 'select', default: '60', options: ['30', '60', '90', '120', '150', '180'].map((v) => ({ value: v, label: `${v} seconds` })) }]
    },
    { id: 'raid', platform, group: 'Stream', label: 'Start raid', confirm: 'Start a raid on this channel?', fields: [{ key: 'login', label: 'Channel name', type: 'text', required: true }] },
    { id: 'raid.cancel', platform, group: 'Stream', label: 'Cancel raid' },
    { id: 'title', platform, group: 'Stream', label: 'Title', fields: [{ key: 'title', label: 'Stream title', type: 'text', required: true }] },
    { id: 'category', platform, group: 'Stream', label: 'Category', fields: [{ key: 'query', label: 'Game or category', type: 'text', required: true }] },
    {
      id: 'poll', platform, group: 'Engage', label: 'Poll',
      fields: [
        { key: 'title', label: 'Question', type: 'text', required: true },
        { key: 'choices', label: 'Choices, one per line', type: 'lines', required: true },
        { key: 'duration', label: 'Seconds', type: 'number', default: '120' }
      ]
    },
    {
      id: 'prediction', platform, group: 'Engage', label: 'Prediction',
      fields: [
        { key: 'title', label: 'Question', type: 'text', required: true },
        { key: 'outcomes', label: 'Outcomes, one per line', type: 'lines', required: true },
        { key: 'window', label: 'Betting seconds', type: 'number', default: '120' }
      ]
    },
    {
      id: 'reward.create', platform, group: 'Rewards', label: 'New reward',
      note: 'Rewards made here can be toggled from this app.',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'cost', label: 'Cost', type: 'number', required: true, default: '500' }
      ]
    }
  ]

  for (const r of rewards?.data ?? []) {
    const mine = own.has(r.id)
    actions.push({
      id: `reward.toggle.${r.id}`, platform, group: 'Rewards', label: `${r.title} (${r.cost})`, active: !!r.is_enabled,
      disabled: !mine, note: mine ? undefined : 'Made on the Twitch dashboard, so only the dashboard can change it.'
    })
  }
  return actions
}

async function userId(helix: Helix, login: string): Promise<string> {
  const r = await helix('GET', '/users', { login: login.trim().replace(/^@/, '').toLowerCase() })
  const id = r.data?.[0]?.id
  if (!id) throw new Error(`Channel "${login}" was not found.`)
  return id
}

export async function runTwitchAction(helix: Helix, id: string, action: string, a: Record<string, string>): Promise<ActionResult> {
  const mod = { broadcaster_id: id, moderator_id: id }

  if (action.startsWith('mode.')) {
    const key = action.slice(5)
    const mode = CHAT_MODES.find((m) => m.key === key)!
    const now = await helix('GET', '/chat/settings', mod)
    const next = !now.data?.[0]?.[key]
    await helix('PATCH', '/chat/settings', mod, mode.apply(next))
    return { ok: true, message: `${mode.label} ${next ? 'on' : 'off'}.` }
  }
  if (action.startsWith('reward.toggle.')) {
    const rewardId = action.slice('reward.toggle.'.length)
    const r = await helix('GET', '/channel_points/custom_rewards', { broadcaster_id: id, id: rewardId })
    await helix('PATCH', '/channel_points/custom_rewards', { broadcaster_id: id, id: rewardId }, { is_enabled: !r.data?.[0]?.is_enabled })
    return { ok: true }
  }

  switch (action) {
    case 'announce':
      await helix('POST', '/chat/announcements', mod, { message: a.message, color: a.color || 'primary' })
      return { ok: true, message: 'Announcement sent.' }
    case 'shoutout':
      await helix('POST', '/chat/shoutouts', { from_broadcaster_id: id, to_broadcaster_id: await userId(helix, a.login), moderator_id: id })
      return { ok: true, message: 'Shoutout sent.' }
    case 'clear':
      await helix('DELETE', '/moderation/chat', mod)
      return { ok: true, message: 'Chat cleared.' }
    case 'shield': {
      const now = await helix('GET', '/moderation/shield_mode', mod)
      const next = !now.data?.[0]?.is_active
      await helix('PUT', '/moderation/shield_mode', mod, { is_active: next })
      return { ok: true, message: `Shield mode ${next ? 'on' : 'off'}.` }
    }
    case 'clip': {
      const r = await helix('POST', '/clips', { broadcaster_id: id })
      return { ok: true, message: `Clip created: ${r.data?.[0]?.id ?? ''}` }
    }
    case 'ad':
      await helix('POST', '/channels/commercial', undefined, { broadcaster_id: id, length: Number(a.length || 60) })
      return { ok: true, message: 'Ad break started.' }
    case 'raid':
      await helix('POST', '/raids', { from_broadcaster_id: id, to_broadcaster_id: await userId(helix, a.login) })
      return { ok: true, message: 'Raid started.' }
    case 'raid.cancel':
      await helix('DELETE', '/raids', { broadcaster_id: id })
      return { ok: true, message: 'Raid cancelled.' }
    case 'title':
      await helix('PATCH', '/channels', { broadcaster_id: id }, { title: a.title })
      return { ok: true, message: 'Title updated.' }
    case 'category': {
      const r = await helix('GET', '/search/categories', { query: a.query, first: '1' })
      const cat = r.data?.[0]
      if (!cat) throw new Error(`No category matches "${a.query}".`)
      await helix('PATCH', '/channels', { broadcaster_id: id }, { game_id: cat.id })
      return { ok: true, message: `Category set to ${cat.name}.` }
    }
    case 'poll':
      await helix('POST', '/polls', undefined, {
        broadcaster_id: id, title: a.title, duration: Number(a.duration || 120),
        choices: a.choices.split('\n').map((s) => s.trim()).filter(Boolean).map((title) => ({ title }))
      })
      return { ok: true, message: 'Poll started.' }
    case 'prediction':
      await helix('POST', '/predictions', undefined, {
        broadcaster_id: id, title: a.title, prediction_window: Number(a.window || 120),
        outcomes: a.outcomes.split('\n').map((s) => s.trim()).filter(Boolean).map((title) => ({ title }))
      })
      return { ok: true, message: 'Prediction started.' }
    case 'reward.create':
      await helix('POST', '/channel_points/custom_rewards', { broadcaster_id: id }, { title: a.title, cost: Number(a.cost) })
      return { ok: true, message: 'Reward created.' }
    case 'reward.fulfill':
    case 'reward.cancel':
      await helix('PATCH', '/channel_points/custom_rewards/redemptions',
        { broadcaster_id: id, reward_id: a.rewardId, id: a.redemptionId },
        { status: action === 'reward.fulfill' ? 'FULFILLED' : 'CANCELED' })
      return { ok: true, message: action === 'reward.fulfill' ? 'Redemption fulfilled.' : 'Redemption refunded.' }
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}
