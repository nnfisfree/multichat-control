import { parseText } from '../shared/parts'
import { PLATFORMS, type HistorySession, type ObsState, type UserEntry, type UserProfile, type UsersInfo } from '../shared/types'
import type {
  ActionDef, ActionResult, ChatMessage, Emote, EventType, HypeTrain, ModerationRequest, Platform, StreamEvent
} from '../shared/types'
import type { Connector, ConnectorContext } from './platforms/connector'
import { store } from './store'

const emoteUrl = (bg: string, face: string): string =>
  'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="${bg}"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">${face}</text></svg>`
  )

const EMOTE_DEFS: Record<Platform, [string, Emote['provider'], string, string, string][]> = {
  twitch: [
    ['nnfHype', 'twitch', 'My Channel Emotes', '#9146ff', '!'], ['nnfLove', 'twitch', 'My Channel Emotes', '#d22bd2', '<3'],
    ['friendWave', 'twitch', 'StreamerFriend Emotes', '#27a9e8', 'W'], ['friendGG', 'twitch', 'StreamerFriend Emotes', '#27a9e8', 'G'],
    ['PogChamp', 'twitch', 'Twitch Global', '#7a4ee0', 'O'], ['Kappa', 'twitch', 'Twitch Global', '#6b5fa0', 'K'],
    ['catJAM', '7tv', '7TV Channel', '#2aa5c9', '^'], ['KEKW', 'bttv', 'BTTV Channel', '#d84848', 'X'],
    ['monkaS', 'ffz', 'FFZ Channel', '#3d9a5b', '?']
  ],
  kick: [
    ['KICKHYPE', 'kick', 'Kick Channel', '#53fc18', 'K'], ['GGkick', 'kick', 'Kick Global', '#3bc411', 'G'],
    ['peepoKick', '7tv', '7TV Kick', '#2aa5c9', 'p']
  ],
  youtube: [['😀', 'emoji', 'Emoji', '', ''], ['🔥', 'emoji', 'Emoji', '', ''], ['🎉', 'emoji', 'Emoji', '', '']]
}

const GROUP_ICON: Record<string, string> = {
  'My Channel Emotes': emoteUrl('#8d1fc8', 'D'),
  'StreamerFriend Emotes': emoteUrl('#27a9e8', 'S')
}

const emotesFor = (p: Platform): Emote[] => EMOTE_DEFS[p].map(([name, provider, group, bg, face]) => ({
  id: name, name, provider, platform: p, group, groupIcon: GROUP_ICON[group], url: bg ? emoteUrl(bg, face) : ''
}))

const CHATTERS: Record<Platform, string[]> = {
  twitch: ['PixelNomad', 'LunaByte', 'TurboTaco', 'NovaRush_', 'CosmicKiwi', 'QuietStorm'],
  youtube: ['Pixel Pete', 'Marta G.', 'Leo the Lion', 'gamer_dad_77'],
  kick: ['kickfan99', 'snowbyte', 'zerocool_x', 'mira.gg']
}
const LINES = [
  'dude haha', 'that was insane', 'nnfHype nnfHype nnfHype', 'gg', 'KEKW', 'catJAM catJAM', 'what game is next?',
  'first time here, love the stream', 'https://example.com/clip check this out', 'PogChamp that play', 'lol', 'KICKHYPE lets go',
  'how long have you been streaming today? this run has been really fun to watch and I hope you keep going for a while',
  '🔥🔥🔥', 'monkaS', 'hello from the demo!'
]
const COLORS = ['#4fd1ff', '#ff7ad9', '#7dff9b', '#ffb454', '#b794ff', '#ff6b6b']

const EVENTS: Record<Platform, { type: EventType; text: string; subject?: string; amount?: string; message?: string; details?: Record<string, string>; big?: boolean }[]> = {
  twitch: [
    { type: 'follow', text: 'followed' },
    { type: 'redemption', text: 'redeemed', subject: 'Daily Check-in', amount: '1', details: { Reward: 'KEKW! [MP3]', Status: 'Unfulfilled' } },
    { type: 'sub', text: 'resubscribed to the channel (5 months)', amount: 'Prime', message: 'u deserve' },
    { type: 'sub', text: 'subscribed to the channel', amount: 'Tier 1' },
    { type: 'gift', text: 'gifted a sub to PixelNomad', amount: 'Tier 1' },
    { type: 'gift', text: 'gifted 50 subs to the community', amount: 'Tier 1 x50', big: true },
    { type: 'powerup', text: 'used', subject: 'On-Screen Celebration', amount: '40 bits' },
    { type: 'raid', text: 'raided with 42 viewers', amount: '42', big: true },
    { type: 'moderation', text: 'timed out TurboTaco', amount: '1m' }
  ],
  youtube: [
    { type: 'paid', text: 'sent a Super Chat', amount: '€5.00', message: 'Keep it up!' },
    { type: 'sub', text: 'became a member', details: { Level: 'Member' } },
    { type: 'gift', text: 'gifted 2 memberships', amount: '2' }
  ],
  kick: [
    { type: 'sub', text: 'subscribed', amount: '1 month' },
    { type: 'gift', text: 'gifted 3 subs', amount: '3' },
    { type: 'follow', text: 'followed' },
    { type: 'redemption', text: 'redeemed', subject: 'Hydrate!', amount: '250' }
  ]
}

const PRONOUNS = ['He/Him', 'She/Her', 'They/Them', 'Any']

const DEMO_GIF = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 135"><rect width="240" height="135" fill="#5b35f0"/><text x="120" y="78" font-size="26" text-anchor="middle" fill="#fff" font-family="sans-serif">GIF</text></svg>')

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]

/**
 * Simulated platform for UI work and automated tests. Runs through the same interface as the
 * real connectors, so `--demo` exercises everything except the network.
 */
export class DemoConnector implements Connector {
  private timers: NodeJS.Timeout[] = []
  private seq = 0
  private toggles: Record<string, boolean> = { slow: false, subonly: false }
  private lookup = new Map<string, { name: string; url: string }>()

  constructor(readonly platform: Platform, private ctx: ConnectorContext, private ratePerMinute: number) {
    void this.refreshEmotes()
  }

  private enabled(): Emote[] {
    const on = store.settings.emoteProviders
    return emotesFor(this.platform).filter((e) => !(e.provider === 'bttv' && !on.bttv) && !(e.provider === '7tv' && !on.seventv) && !(e.provider === 'ffz' && !on.ffz))
  }

  async refreshEmotes(): Promise<void> {
    this.lookup = new Map(this.enabled().filter((e) => e.url).map((e) => [e.name, { name: e.name, url: e.url }]))
  }

  private msg(name: string, text: string, over: Partial<ChatMessage> = {}): ChatMessage {
    const i = CHATTERS[this.platform].indexOf(name)
    const login = name.toLowerCase()
    if (this.platform === 'twitch' && i >= 0 && store.settings.showPronouns) this.ctx.pronoun(login, PRONOUNS[i % PRONOUNS.length])
    return {
      id: `${this.platform}-${++this.seq}`,
      platform: this.platform,
      ts: Date.now(),
      kind: 'chat',
      parts: parseText(text, this.lookup),
      author: { id: name, name, login, color: COLORS[Math.abs(i) % COLORS.length], badges: i === 0 ? [{ id: 'mod', title: 'Moderator' }] : [], isMod: i === 0, isMember: this.platform === 'youtube' && i === 1 },
      ...over
    }
  }

  private tickChat(): void {
    const r = Math.random()
    if (this.platform === 'twitch' && r < 0.05) {
      const bits = pick([100, 500, 1000])
      this.ctx.message(this.msg(pick(CHATTERS.twitch), '', { kind: 'cheer', label: `${bits} BITS`, parts: [{ type: 'emote', name: `Cheer${bits}`, url: emoteUrl('#9146ff', 'B') }, { type: 'text', text: `${bits} let's go!` }] }))
      return
    }
    if (this.platform === 'twitch' && r < 0.08) {
      this.ctx.message(this.msg(pick(CHATTERS.twitch), '', { parts: [{ type: 'gif', url: DEMO_GIF, alt: 'Dancing cat' }] }))
      return
    }
    this.ctx.message(this.msg(pick(CHATTERS[this.platform]), pick(LINES), {
      firstTime: r < 0.04,
      reply: r > 0.93 ? { author: pick(CHATTERS[this.platform]), text: pick(LINES) } : undefined
    }))
  }

  private tickEvent(): void {
    const e = pick(EVENTS[this.platform])
    const id = `${this.platform}-ev-${++this.seq}`
    const ev: StreamEvent = {
      id, platform: this.platform, ts: Date.now(), actor: pick(CHATTERS[this.platform]), details: {},
      ...e,
      actions: e.type === 'redemption'
        ? [{ actionId: 'reward.fulfill', label: 'Fulfil', args: { id }, tone: 'good' }, { actionId: 'reward.cancel', label: 'Refund', args: { id }, tone: 'bad' }]
        : undefined
    }
    this.ctx.event(ev)
  }

  async start(): Promise<void> {
    // Platforms connect one after another, as they do for real, so the progress bar shows.
    this.ctx.status({ status: 'connecting' })
    const order = ['twitch', 'youtube', 'kick'].indexOf(this.platform)
    this.timers.push(setTimeout(() => this.ctx.status({ status: 'connected', account: 'DemoStreamer' }), 2500 + order * 1800))
    // The streamer testing their own reward, so the TEST tag and Clear menu have something to show.
    if (this.platform === 'twitch') {
      this.timers.push(setTimeout(() => this.ctx.event({
        id: `twitch-test-${Date.now()}`, platform: 'twitch', ts: Date.now(), type: 'redemption', actor: 'DemoStreamer',
        text: 'redeemed', subject: 'Hydrate!', amount: '500', details: {}
      }), 4000))
    }
    this.timers.push(setInterval(() => this.tickChat(), 60000 / this.ratePerMinute))
    this.timers.push(setInterval(() => this.tickEvent(), 5000 + Math.random() * 2000))
    if (this.platform === 'twitch') {
      this.startHype()
      this.timers.push(setInterval(() => this.ctx.message(this.msg(pick(CHATTERS.twitch), '', { parts: [{ type: 'gif', url: DEMO_GIF, alt: 'Dancing cat' }] })), 4000))
    }
    for (let i = 0; i < 12; i++) this.tickChat()
    for (let i = 0; i < 4; i++) this.tickEvent()
  }

  private startHype(): void {
    const train: HypeTrain = {
      platform: 'twitch', level: 2, progress: 300, goal: 1800, total: 4300, expiresAt: Date.now() + 280000, type: 'regular',
      top: [{ name: 'PixelNomad', kind: 'bits', total: 1200 }, { name: 'NovaRush_', kind: 'subscription', total: 2500 }]
    }
    this.ctx.hype(train)
    this.timers.push(setInterval(() => {
      train.progress += 180
      if (train.progress >= train.goal) {
        train.progress = 0
        train.level++
      }
      this.ctx.hype({ ...train })
    }, 2000))
  }

  async stop(): Promise<void> {
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  async login(): Promise<void> {}
  async logout(): Promise<void> {}

  async send(text: string): Promise<void> {
    this.ctx.message(this.msg('DemoStreamer', text, { author: { id: 'me', name: 'DemoStreamer', color: '#ffb454', badges: [{ id: 'broadcaster', title: 'Broadcaster' }], isBroadcaster: true } }))
  }

  /** Invented account details for the user card. */
  async profile(user: UserEntry): Promise<UserProfile> {
    const day = 86400000
    const fresh = user.name === 'TurboTaco'
    return {
      createdAt: Date.now() - (fresh ? 2 : 900) * day,
      followedAt: fresh ? null : Date.now() - 120 * day,
      sub: this.platform === 'youtube' ? undefined : user.name === 'CosmicKiwi' ? { tier: 'Tier 1', months: 5 } : null,
      member: this.platform === 'youtube' ? user.name === 'Marta G.' : undefined,
      banned: null,
      roles: CHATTERS[this.platform].indexOf(user.name) === 0 ? ['Moderator'] : [],
      url: 'https://example.com/'
    }
  }

  /** Invented viewers: Twitch gets a full list, as it would for real; the others report a count. */
  async users(): Promise<UsersInfo> {
    const viewers = { twitch: 142, youtube: 37, kick: 58 }[this.platform]
    if (this.platform !== 'twitch') return { live: true, viewers }
    const u = (name: string): UserEntry => ({ id: name, name, login: name.toLowerCase(), color: COLORS[Math.abs(CHATTERS.twitch.indexOf(name)) % COLORS.length] })
    const lurkers = ['QuietMoth', 'PixelPanda', 'AstroLatte', 'NightOwl_92', 'SoftReset', 'Blinky', 'CozyGamer', 'LateNightLuna'].map((name) => ({ id: name, name, login: name.toLowerCase() }))
    return {
      live: true, viewers,
      groups: {
        broadcaster: [{ id: 'demo', name: 'DemoStreamer', login: 'demostreamer' }],
        moderators: [u(CHATTERS.twitch[0]), { id: 'streamelements', name: 'StreamElements', login: 'streamelements' }],
        vips: [u(CHATTERS.twitch[1])],
        members: [],
        users: [...CHATTERS.twitch.slice(2).map(u), ...lurkers]
      }
    }
  }

  async moderate(req: ModerationRequest): Promise<ActionResult> {
    if (req.kind === 'delete') this.ctx.deleted(req.messageId)
    if (req.kind === 'timeout' || req.kind === 'ban') this.ctx.purged(req.userId)
    return { ok: true, message: `Demo: ${req.kind} done.` }
  }

  async emotes(): Promise<Emote[]> {
    return this.enabled()
  }

  async actions(): Promise<ActionDef[]> {
    const p = this.platform
    if (p !== 'twitch') return [{ id: 'title', platform: p, group: 'Stream', label: 'Set title', fields: [{ key: 'title', label: 'Title', type: 'text', required: true }] }]
    return [
      { id: 'announce', platform: p, group: 'Chat', label: 'Announcement', fields: [{ key: 'message', label: 'Message', type: 'text', required: true }] },
      { id: 'slow', platform: p, group: 'Chat modes', label: 'Slow mode', active: this.toggles.slow },
      { id: 'subonly', platform: p, group: 'Chat modes', label: 'Sub-only', active: this.toggles.subonly },
      { id: 'ad', platform: p, group: 'Stream', label: 'Run ad', confirm: 'Start a 60 second ad break now?' },
      { id: 'raid', platform: p, group: 'Stream', label: 'Raid', fields: [{ key: 'to', label: 'Channel', type: 'text', required: true }], confirm: 'Raid this channel?' }
    ]
  }

  async runAction(actionId: string): Promise<ActionResult> {
    if (actionId in this.toggles) this.toggles[actionId] = !this.toggles[actionId]
    return { ok: true, message: `Demo: ${actionId} done.` }
  }
}

/** Two invented past streams, so demo mode can show the chat history. */
export const demoHistory = (() => {
  let cleared = false
  const day = 24 * 60 * 60 * 1000
  const make = (id: string, start: number, count: number): ChatMessage[] => Array.from({ length: count }, (_, i) => {
    const platform = PLATFORMS[i % 3]
    const name = CHATTERS[platform][(i * 7) % CHATTERS[platform].length]
    return {
      id: `${id}-${i}`, platform, ts: start + i * 45000, kind: 'chat' as const, history: true,
      author: { id: name, name, login: name.toLowerCase(), color: COLORS[(i * 5) % COLORS.length], badges: [] },
      parts: [{ type: 'text' as const, text: LINES[(i * 3) % LINES.length] }]
    }
  })
  const sessions = (): HistorySession[] => (cleared ? [] : [
    { id: 'stream-demo-1', start: Date.now() - 3 * day, end: Date.now() - 3 * day + 30 * 45000, count: 30 },
    { id: 'stream-demo-2', start: Date.now() - day, end: Date.now() - day + 30 * 45000, count: 30 }
  ])
  return {
    sessions,
    load: (id: string): ChatMessage[] => {
      const s = sessions().find((x) => x.id === id)
      return s ? make(id, s.start, s.count) : []
    },
    clear: () => { cleared = true }
  }
})()

/** Invented OBS stats for demo mode: ready at first, then live a few seconds later. */
export function startDemoObs(send: (s: ObsState) => void): void {
  const started = Date.now()
  let bytes = 0
  setTimeout(() => send({ status: 'connecting' }), 300)
  setInterval(() => {
    const t = Date.now() - started
    const live = t > 9000
    const kbps = 5800 + Math.round(Math.random() * 400)
    if (live) bytes += (kbps * 1000 / 8) * 2
    send({
      status: 'connected',
      stats: {
        cpu: 1 + Math.random() * 2, memoryMb: 2562.9, diskMb: 386.6 * 1024, fps: 60, renderMs: 1.2,
        encoder: 'NVIDIA NVENC H.264', output: { width: 1920, height: 1080, fps: 60, canvas: { width: 2560, height: 1440 } },
        renderMissed: 0, renderTotal: Math.round(t / 16.7), encodeSkipped: 0, encodeTotal: live ? Math.round((t - 9000) / 16.7) : 0,
        stream: { active: live, reconnecting: false, durationMs: live ? t - 9000 + 6130000 : 0, dropped: live ? 3 : 0, total: live ? Math.round((t - 9000) / 16.7) + 368000 : 0, bytes, kbps: live ? kbps : undefined },
        record: { active: false, paused: false, durationMs: 0, bytes: 0 }
      }
    })
  }, 2000)
}
