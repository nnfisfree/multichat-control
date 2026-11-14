import { parseText, type PreviewTarget } from '../shared/parts'
import { PLATFORMS, type HistorySession, type ObsState, type StreamerbotState, type UserEntry, type UserProfile, type UsersInfo } from '../shared/types'
import type {
  ActionDef, ActionResult, ChannelStats, ChatMessage, CommandOutcome, Emote, EventType, HypeTrain, LinkPreview, ModerationRequest, Platform, StreamEvent
} from '../shared/types'
import type { Connector, ConnectorContext } from './platforms/connector'
import { store } from './store'

/** A made-up video picture: a sky, hills and a sun, in the given colours. */
const demoThumb = (sky: string, hill: string, sun: string): string =>
  'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#140c2c"/></linearGradient></defs>` +
    `<rect width="320" height="180" fill="url(#s)"/><circle cx="226" cy="74" r="30" fill="${sun}"/><path d="M0 140 Q70 92 150 132 T320 120 V180 H0z" fill="${hill}"/><path d="M0 160 Q90 128 190 158 T320 150 V180 H0z" fill="#0d0820" opacity="0.7"/></svg>`
  )

const DEMO_PREVIEWS: Record<PreviewTarget['kind'], LinkPreview> = {
  'youtube': { url: 'https://www.youtube.com/', platform: 'youtube', kind: 'video', title: 'Lo-fi beats to stream to (1 hour mix)', channel: 'Chill Corner', thumbnail: demoThumb('#ff6a88', '#5a2a7a', '#ffd36e') },
  'youtube-clip': { url: 'https://www.youtube.com/', platform: 'youtube', kind: 'clip', title: 'That speedrun skip', channel: 'DemoStreamer', thumbnail: demoThumb('#4fb3ff', '#2a4a7a', '#fff3b0') },
  'twitch-clip': { url: 'https://www.twitch.tv/', platform: 'twitch', kind: 'clip', title: 'The jump that should not have worked', channel: 'DemoStreamer', clippedBy: 'PixelNomad', seconds: 28, views: 1342, thumbnail: demoThumb('#9146ff', '#3b1f7a', '#ffb454') },
  'kick-clip': { url: 'https://kick.com/', platform: 'kick', kind: 'clip', title: 'Clutch 1v3 on stream', channel: 'DemoStreamer', clippedBy: 'kickfan99', seconds: 45, views: 213, thumbnail: demoThumb('#1fbf6a', '#145a33', '#e6ff7a') }
}

/** The demo's answer for a link card. */
export const demoPreview = (t: PreviewTarget): LinkPreview => ({ ...DEMO_PREVIEWS[t.kind] })

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
  '🔥🔥🔥', 'monkaS', 'hello from the demo!', '@DemoStreamer can you read this? 👀', '@demostreamer what are your settings?',
  'https://youtu.be/dEmOVid3o01 this song slaps', 'https://clips.twitch.tv/DemoJumpThatWorked-n1ce LMAO look at this',
  'https://kick.com/demostreamer/clips/clip_01DEMOCLIP000000000000 replay this'
]
const COLORS = ['#4fd1ff', '#ff7ad9', '#7dff9b', '#ffb454', '#b794ff', '#ff6b6b']

const EVENTS: Record<Platform, { type: EventType; text: string; subject?: string; amount?: string; message?: string; details?: Record<string, string>; big?: boolean; source?: StreamEvent['source']; preview?: LinkPreview }[]> = {
  twitch: [
    { type: 'follow', text: 'followed' },
    { type: 'redemption', text: 'redeemed', subject: 'Daily Check-in', amount: '1', details: { Reward: 'KEKW! [MP3]', Status: 'Unfulfilled' } },
    { type: 'sub', text: 'resubscribed to the channel (5 months)', amount: 'Prime', message: 'u deserve' },
    { type: 'sub', text: 'resubscribed to the channel (14 months)', amount: 'Tier 1', message: 'Over a year already, still the comfiest stream around 💜' },
    { type: 'cheer', text: 'cheered', amount: '500 bits', message: 'Take my bits, legend! That clutch was unreal' },
    { type: 'sub', text: 'subscribed to the channel', amount: 'Tier 1' },
    { type: 'gift', text: 'gifted a sub to PixelNomad', amount: 'Tier 1' },
    { type: 'gift', text: 'gifted 50 subs to the community', amount: 'Tier 1 x50', big: true },
    { type: 'powerup', text: 'used', subject: 'On-Screen Celebration', amount: '40 bits' },
    { type: 'raid', text: 'raided with 42 viewers', amount: '42', big: true },
    { type: 'moderation', text: 'timed out TurboTaco', amount: '1m' },
    { type: 'donation', text: 'donated', amount: '$10.00', message: 'For the snacks!', source: 'streamlabs' },
    { type: 'donation', text: 'donated', amount: '€25.00', message: 'Great stream today', source: 'streamelements', big: true },
    { type: 'donation', text: 'bought 3 coffees', amount: '$15.00', message: 'Fuel for the next stream ☕', source: 'buymeacoffee', details: { Coffees: '3' } },
    {
      type: 'sub', text: 'renewed their membership (7 months)', amount: 'Coffee Club', source: 'buymeacoffee',
      details: { Level: 'Coffee Club', 'Total months': '7', Plan: 'Monthly', Amount: '$5.00/month' }
    }
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
/** A made-up channel picture for the demo raid. */
const DEMO_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#9146ff"/></linearGradient></defs>' + '<rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="26" r="12" fill="#ffe3c7"/><path d="M10 64c2-14 12-20 22-20s20 6 22 20z" fill="#1b1440"/><path d="M19 24c0-10 6-15 13-15s13 5 13 15c-3-5-8-7-13-7s-10 2-13 7z" fill="#3a1f12"/></svg>')

export class DemoConnector implements Connector {
  private raidTimer: ReturnType<typeof setTimeout> | undefined
  private timers: ReturnType<typeof setTimeout>[] = []
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
    if (this.platform === 'twitch' && r < 0.06) {
      this.ctx.message(this.msg(pick(CHATTERS.twitch), '', { parts: [{ type: 'gif', url: DEMO_GIF, alt: 'Dancing cat' }] }))
      return
    }
    // Links bring big preview cards, so they come up only now and then.
    let line = pick(LINES)
    if (line.includes('https://') && Math.random() > 0.2) line = pick(LINES.filter((l) => !l.includes('https://')))
    this.ctx.message(this.msg(pick(CHATTERS[this.platform]), line, {
      firstTime: r < 0.04,
      reply: r > 0.93 ? { author: pick(CHATTERS[this.platform]), text: pick(LINES) } : undefined
    }))
  }

  private tickEvent(): void {
    const e = pick(EVENTS[this.platform])
    const id = `${this.platform}-ev-${++this.seq}`
    const actor = pick(CHATTERS[this.platform])
    const ev: StreamEvent = {
      id, platform: this.platform, ts: Date.now(), actor, details: {},
      ...e,
      preview: e.preview && { ...e.preview, clippedBy: actor },
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
    this.timers.push(setTimeout(() => this.ctx.status({ status: 'connected', account: 'DemoStreamer', mentions: ['DemoStreamer'] }), 2500 + order * 1800))
    // A Streamer.bot test trigger, so the TEST tag and Clear menu have something to show.
    if (this.platform === 'twitch') {
      this.timers.push(setTimeout(() => this.ctx.event({
        id: `twitch-test-${Date.now()}`, platform: 'twitch', ts: Date.now(), type: 'redemption', actor: 'DemoStreamer',
        text: 'redeemed', subject: 'Hydrate!', amount: '500', details: {}, test: true
      }), 4000))
    }
    this.timers.push(setInterval(() => this.tickChat(), 60000 / this.ratePerMinute))
    this.timers.push(setInterval(() => this.tickEvent(), 5000 + Math.random() * 2000))
    if (this.platform === 'twitch') this.startHype()
    for (let i = 0; i < 12; i++) this.tickChat()
    for (let i = 0; i < 4; i++) this.tickEvent()
    // One of each moderator warning soon after start, then now and then.
    const soon = (ms: number, run: () => void): void => { this.timers.push(setTimeout(run, ms)) }
    if (this.platform === 'twitch') {
      // Close together, so all three can be seen at once.
      soon(6000, () => this.tickModeration('held'))
      soon(6600, () => this.tickModeration('suspicious'))
      soon(7200, () => this.tickModeration('spam'))
      this.timers.push(setInterval(() => this.tickModeration(pick(['held', 'suspicious'] as const)), 75000))
    } else soon(30000 + Math.random() * 30000, () => this.tickModeration('spam'))
    this.timers.push(setInterval(() => this.tickModeration('spam'), 120000 + Math.random() * 60000))
  }

  private startHype(): void {
    const train: HypeTrain = {
      platform: 'twitch', level: 2, progress: 300, goal: 1800, total: 4300, expiresAt: Date.now() + 280000, type: 'regular',
      top: [{ name: 'PixelNomad', kind: 'bits', total: 1200 }, { name: 'NovaRush_', kind: 'subscription', total: 2500 }]
    }
    this.ctx.hype(train)
    let ticks = 0
    this.timers.push(setInterval(() => {
      // Like a real one, the train ends after a while (40 s here) and another starts 40 s later.
      ticks = (ticks + 1) % 40
      if (ticks === 20) return this.ctx.hype(null)
      if (ticks > 20) return
      if (ticks === 0) { train.level = 2; train.progress = 300 }
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

  /** Invented audience counts. */
  async stats(): Promise<ChannelStats> {
    return { twitch: { followers: 4343, subscribers: 261 }, youtube: { subscribers: 12300, rounded: true }, kick: { followers: 1874, subscribers: 57, gifted: 12 } }[this.platform]
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

  /** Demo Twitch commands: pins show in the app, everything else just says it worked. */
  async command(text: string): Promise<CommandOutcome | null> {
    if (this.platform !== 'twitch') return null
    const [head, ...rest] = text.trim().split(/\s+/)
    const name = head.toLowerCase()
    if (name === '/pin') {
      const minutes = /^(\d+)m$/i.exec(rest[0] ?? '')
      const body = (minutes ? rest.slice(1) : rest).join(' ')
      this.ctx.pinned?.({ id: `pin-${Date.now()}`, text: body, sender: 'DemoStreamer', endsAt: minutes ? Date.now() + Number(minutes[1]) * 60000 : undefined })
      return { ok: true, message: minutes ? `Pinned for ${minutes[1]} minutes.` : 'Pinned until the stream ends.' }
    }
    if (name === '/unpin') { this.ctx.pinned?.(null); return { ok: true, message: 'Unpinned.' } }
    if (name === '/raid') {
      const who = (rest[0] ?? 'PixelPaladin').replace(/^@/, '')
      const now = Date.now()
      this.ctx.raid?.({ login: who.toLowerCase(), name: who, avatar: DEMO_AVATAR, game: 'Elden Ring', title: 'First blind run! Malenia attempts all night', viewers: 1284, live: true, startedAt: now, endsAt: now + 90_000 })
      clearTimeout(this.raidTimer)
      this.raidTimer = setTimeout(() => this.ctx.raid?.(null), 90_000)
      return { ok: true, message: `Raiding ${who} when Twitch's countdown ends.` }
    }
    if (name === '/raidnow') {
      clearTimeout(this.raidTimer)
      this.raidTimer = setTimeout(() => this.ctx.raid?.(null), 1500)
      return { ok: true, message: 'Raid sent.' }
    }
    if (name === '/unraid') { clearTimeout(this.raidTimer); this.ctx.raid?.(null); return { ok: true, message: 'Raid canceled.' } }
    if (name === '/user' && rest[0]) return { ok: true, openUser: { id: rest[0], name: rest[0], login: rest[0].toLowerCase() } }
    return { ok: true, message: `Demo: ${name} done.` }
  }

  /** Allow shows the held message in chat, as Twitch does; Deny keeps it out. */
  async automod(rowId: string, allow: boolean): Promise<ActionResult> {
    let held: ChatMessage | undefined
    const found = this.ctx.patch(rowId, (m) => {
      held = m
      return { held: { ...m.held!, status: allow ? 'allowed' : 'denied', by: 'DemoStreamer' } }
    })
    if (!found) return { ok: false, message: 'That message is gone.' }
    if (allow && held) this.ctx.message({ ...held, id: `${this.platform}-${++this.seq}`, ts: Date.now(), held: undefined })
    return { ok: true }
  }

  /** The moderator warnings: a message AutoMod held, a suspicious user, and a "buy followers" bot. */
  private tickModeration(which: 'held' | 'suspicious' | 'spam'): void {
    if (which === 'held') {
      const text = pick(['this streamer is so bad lmao', 'go touch grass you absolute clown', 'check my channel twitch.tv/notabot'])
      this.ctx.message(this.msg('QuietStorm', text, {
        id: `held:demo-${++this.seq}`,
        held: { reason: pick(['AutoMod: Bullying (level 2)', 'AutoMod: Swearing (level 3)', 'Blocked term', 'Blocked link']), status: 'pending' }
      }))
    } else if (which === 'suspicious') {
      this.ctx.message(this.msg('n0t_a_banned_guy', 'hey guys im new here', {
        author: { id: 'n0t_a_banned_guy', name: 'n0t_a_banned_guy', login: 'n0t_a_banned_guy', color: '#ff6b6b', badges: [] },
        flag: { kind: 'suspicious', label: 'Suspicious user', notes: ['Likely ban evader', 'Banned in 2 channels that share ban info with you'] }
      }))
    } else {
      // No flag here: the hub's spam check finds it, as it would in real chat.
      const bot = this.platform === 'kick' ? 'promo_kick_42' : this.platform === 'youtube' ? 'Grow Your Stream' : 'streampromo_88'
      this.ctx.message(this.msg(bot, 'Wanna become famous? Buy followers, primes and viewers on streamb00st . com', {
        author: { id: bot, name: bot, login: bot.toLowerCase(), color: '#9aa0a6', badges: [] }
      }))
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
      parts: parseText(LINES[(i * 3) % LINES.length])
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
        at: Date.now(), cpu: 1 + Math.random() * 2, memoryMb: 2562.9, diskMb: 386.6 * 1024, fps: 60, renderMs: 1.2,
        encoder: 'NVIDIA NVENC H.264', output: { width: 1920, height: 1080, fps: 60, canvas: { width: 2560, height: 1440 } },
        renderMissed: 0, renderTotal: Math.round(t / 16.7), encodeSkipped: 0, encodeTotal: live ? Math.round((t - 9000) / 16.7) : 0,
        stream: { active: live, reconnecting: false, durationMs: live ? t - 9000 + 6130000 : 0, dropped: live ? 3 : 0, total: live ? Math.round((t - 9000) / 16.7) + 368000 : 0, bytes, kbps: live ? kbps : undefined },
        record: { active: false, paused: false, durationMs: 0, bytes: 0 }
      }
    })
  }, 2000)
}

/** Invented Streamer.bot actions and commands for demo mode. */
export const DEMO_STREAMERBOT: StreamerbotState = {
  status: 'connected',
  version: '1.0.7',
  actions: [
    { id: 'demo-1', name: 'Hydrate Reminder', group: 'Alerts', enabled: true },
    { id: 'demo-2', name: 'Scene: Be Right Back', group: 'Scenes', enabled: true },
    { id: 'demo-3', name: 'Scene: Just Chatting', group: 'Scenes', enabled: true },
    { id: 'demo-4', name: 'Shoutout Last Raider', group: 'Shoutouts', enabled: true },
    { id: 'demo-5', name: 'Sound: Airhorn', group: 'Sounds', enabled: true }
  ],
  commands: [
    { id: 'demo-c1', name: 'Discord', group: '', enabled: true, commands: ['!discord'] },
    { id: 'demo-c2', name: 'Lurk', group: '', enabled: true, commands: ['!lurk'] },
    { id: 'demo-c3', name: 'Socials', group: '', enabled: true, commands: ['!socials', '!twitter'] }
  ]
}
