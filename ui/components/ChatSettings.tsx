import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import { PLATFORM_EVENTS, PREF_PLATFORMS, defaultShow, eventShow, type PrefPlatform } from '../../shared/event-prefs'
import { ANIMATION_KINDS, PLATFORM_LABEL, animationPref, type AnimationKind, type ChatEventGroup, type EventShow, type EventType, type NameColorMode, type NameRole, type PlatformPrefs, type Settings } from '../../shared/types'
import { updateSettings, useStore } from '../lib/store'
import { NAME_ROLES, nameColor } from '../lib/nameColor'
import { Icon, PlatformIcon } from './Icons'
import { MarkedUsers, Row, Toggle } from './SettingsParts'

type FoldId = 'messages' | 'platforms' | 'popups' | 'animations' | 'other' | 'people' | 'emotes'

// which sections are open, kept while the app runs (Chat opens on Platforms, Events on Pop-ups)
let openFolds: Set<FoldId> = new Set(['platforms', 'popups'])
// the platform last picked in Platforms
let lastPlatform: PrefPlatform = 'twitch'

// a Settings jump (What's new, links) to one of these opens its section
const TARGET_FOLD: Record<string, FoldId> = {
  'messages-settings': 'messages',
  'platform-settings': 'platforms',
  'chat-events-settings': 'platforms',
  'popup-settings': 'popups',
  'animation-settings': 'animations',
  'people-settings': 'people',
  'emote-settings': 'emotes',
  'other-events-settings': 'other'
}

/** Section ids that live on the Events & Alerts page, so older jumps to Chat still land there. */
export const EVENT_TARGETS = ['popup-settings', 'animation-settings', 'other-events-settings']

/** Open/closed state for the folds, opening the one a Settings jump points at. */
function useFolds(target?: string): (id: FoldId) => { open: boolean; onToggle(): void } {
  const [open, setOpen] = useState<Set<FoldId>>(() => {
    const t = target && TARGET_FOLD[target]
    if (t) openFolds = new Set([...openFolds, t])
    return openFolds
  })
  return (id) => ({
    open: open.has(id),
    onToggle: () => {
      const next = new Set(open)
      if (!next.delete(id)) next.add(id)
      openFolds = next
      setOpen(next)
    }
  })
}

/** A section that folds away, so the Chat page stays short. */
function Fold({ id, title, desc, open, onToggle, children }: { id: string; title: string; desc: string; open: boolean; onToggle(): void; children: ReactNode }): JSX.Element {
  return (
    <section className={`set-section fold${open ? ' open' : ''}`} id={id}>
      <button className="sec-head fold-head" aria-expanded={open} onClick={onToggle}>
        <span className="fold-text">
          <h3>{title}</h3>
          <p>{desc}</p>
        </span>
        <span className="fold-chev"><Icon.chevron /></span>
      </button>
      {open && <div className="sec-body">{children}</div>}
    </section>
  )
}

const COLOR_MODES: { mode: NameColorMode; label: string }[] = [
  { mode: 'default', label: 'Their own colour' },
  { mode: 'platform', label: 'Platform colour' },
  { mode: 'random', label: 'Random, one per person' },
  { mode: 'custom', label: 'One colour for everyone' }
]

// a few made-up chatters to preview the colours with
const SAMPLE: { name: string; color: string; role?: NameRole }[] = [
  { name: 'You', color: '#ff7f50', role: 'broadcaster' },
  { name: 'ModMarie', color: '#1e90ff', role: 'mod' },
  { name: 'VipVince', color: '#daa520', role: 'vip' },
  { name: 'SubSam', color: '#9acd32', role: 'member' },
  { name: 'ViewerVi', color: '#ff69b4' }
]

function NamePreview({ platform, prefs }: { platform: PrefPlatform; prefs: PlatformPrefs | undefined }): JSX.Element {
  return (
    <div className="name-preview" aria-label="Preview">
      {SAMPLE.map((u) => (
        <b key={u.name} style={{ color: nameColor({ platform, author: { id: u.name, name: u.name, color: u.color, badges: [], isBroadcaster: u.role === 'broadcaster', isMod: u.role === 'mod', isVip: u.role === 'vip', isMember: u.role === 'member' } }, prefs) }}>{u.name}</b>
      ))}
    </div>
  )
}

function EventsTable({ platform, s, setEvent, resetEvents }: { platform: PrefPlatform; s: Settings; setEvent(types: EventType[], where: keyof EventShow, on: boolean): void; resetEvents(types?: EventType[]): void }): JSX.Element {
  const [q, setQ] = useState('')
  const all = PLATFORM_EVENTS[platform]
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return all.filter((r) => !t || r.label.toLowerCase().includes(t) || r.desc?.toLowerCase().includes(t))
  }, [all, q])
  const types = rows.map((r) => r.type)
  const shows = rows.map((r) => eventShow(s, platform, r.type))
  const allOn = (w: keyof EventShow): boolean => shows.length > 0 && shows.every((x) => x[w])
  const changed = (type: EventType): boolean => {
    const d = defaultShow(type)
    const x = eventShow(s, platform, type)
    return x.chat !== d.chat || x.feed !== d.feed
  }
  const anyChanged = rows.some((r) => changed(r.type))
  return (
    <div className="ev-table">
      <div className="ev-tools">
        <label className="users-filter ev-search">
          <Icon.search />
          <input placeholder="Filter events" aria-label="Filter events" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="ev-count">{rows.length} of {all.length} events</span>
      </div>
      <div className="ev-grid" role="table" aria-label={`${PLATFORM_LABEL[platform]} events`}>
        <div className="ev-row ev-th" role="row">
          <span role="columnheader">Event</span>
          <span role="columnheader" title="A card in chat">Chat</span>
          <span role="columnheader" title="The Events tab and its pop-ups">Events tab</span>
          <span role="columnheader" aria-label="Reset" />
        </div>
        {rows.length > 1 && (
          <div className="ev-row ev-all" role="row">
            <span role="cell"><b>All {q ? 'shown' : 'events'}</b></span>
            <span role="cell"><Toggle label="All events in chat" on={allOn('chat')} onChange={(v) => setEvent(types, 'chat', v)} /></span>
            <span role="cell"><Toggle label="All events in the Events tab" on={allOn('feed')} onChange={(v) => setEvent(types, 'feed', v)} /></span>
            <span role="cell">{anyChanged && <button className="icon-btn ev-reset" title="Back to the defaults" aria-label="Reset all to the defaults" onClick={() => resetEvents(types)}><Icon.reset /></button>}</span>
          </div>
        )}
        {rows.map((r, i) => (
          <div key={r.type} className="ev-row" role="row">
            <span role="cell" className="ev-name">{r.label}{r.desc && <small>{r.desc}</small>}</span>
            <span role="cell"><Toggle label={`${r.label} in chat`} on={shows[i].chat} onChange={(v) => setEvent([r.type], 'chat', v)} /></span>
            <span role="cell"><Toggle label={`${r.label} in the Events tab`} on={shows[i].feed} onChange={(v) => setEvent([r.type], 'feed', v)} /></span>
            <span role="cell">{changed(r.type) && <button className="icon-btn ev-reset" title="Back to the default" aria-label={`Reset ${r.label}`} onClick={() => resetEvents([r.type])}><Icon.reset /></button>}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="hint ev-none">No events match.</p>}
      </div>
    </div>
  )
}

function PlatformPanel({ s }: { s: Settings }): JSX.Element {
  const [p, setP] = useState<PrefPlatform>(lastPlatform)
  const [rolesOpen, setRolesOpen] = useState(false)
  const pick = (x: PrefPlatform): void => { lastPlatform = x; setP(x) }
  const prefs = s.platformPrefs?.[p]
  const save = (patch: Partial<PlatformPrefs>): void => {
    void updateSettings({ platformPrefs: { ...s.platformPrefs, [p]: { ...prefs, ...patch } } })
  }
  const setEvent = (types: EventType[], where: keyof EventShow, on: boolean): void => {
    const events = { ...prefs?.events }
    for (const t of types) {
      const next = { ...events[t], [where]: on }
      // only keep what differs from the default
      const d = defaultShow(t)
      if (next.chat === d.chat) delete next.chat
      if (next.feed === d.feed) delete next.feed
      if (Object.keys(next).length) events[t] = next
      else delete events[t]
    }
    save({ events })
  }
  const resetEvents = (types?: EventType[]): void => {
    const events = { ...prefs?.events }
    for (const t of types ?? (Object.keys(events) as EventType[])) delete events[t]
    save({ events })
  }
  const mode = prefs?.nameColor ?? 'default'
  const roleColors = prefs?.roleColors ?? {}
  const setRole = (role: NameRole, color: string | null): void => {
    const next = { ...roleColors }
    if (color) next[role] = color
    else delete next[role]
    save({ roleColors: next })
  }
  const roleCount = Object.keys(roleColors).length

  return (
    <div className="pf-panel">
      <div className="pf-picker" role="tablist" aria-label="Platform">
        {PREF_PLATFORMS.map((x) => (
          <button key={x} role="tab" aria-selected={p === x} className={`pf-pick ${x}${p === x ? ' on' : ''}`} onClick={() => pick(x)}>
            <PlatformIcon platform={x} size={16} /> {PLATFORM_LABEL[x]}
          </button>
        ))}
      </div>

      {/* side by side when the section is wide enough, stacked otherwise */}
      <div className="pf-cols">
      <div className="pf-col">
      {p === 'twitch' && <>
        <h4 className="pf-sub">Messages</h4>
        <Row title="Show Pronouns" desc="For chatters who set them at pronouns.alejo.io. Sends chatter names to that service.">
          <Toggle label="Show pronouns" on={s.showPronouns} onChange={(v) => void updateSettings({ showPronouns: v })} />
        </Row>
        <Row title="Show GIFs" desc="Animated GIFs sent in Twitch chat. Off shows just their name.">
          <Toggle label="Show GIFs" on={prefs?.showGifs ?? true} onChange={(v) => save({ showGifs: v ? undefined : false })} />
        </Row>
      </>}

      <h4 className="pf-sub">Username Colours</h4>
      <Row title="Username Colour" desc={`How ${PLATFORM_LABEL[p]} names are coloured in chat`}>
        <div className="color-pick">
          {mode === 'custom' && <input type="color" aria-label="Colour for everyone" value={prefs?.customColor ?? '#bf94ff'} onChange={(e) => save({ customColor: e.target.value })} />}
          <select aria-label="Username colour" value={mode} onChange={(e) => save({ nameColor: e.target.value === 'default' ? undefined : e.target.value as NameColorMode, ...(e.target.value === 'custom' && !prefs?.customColor ? { customColor: '#bf94ff' } : {}) })}>
            {COLOR_MODES.map((c) => <option key={c.mode} value={c.mode}>{c.label}</option>)}
          </select>
          <button className="icon-btn" title="Back to their own colours" aria-label="Reset username colours" disabled={mode === 'default' && !roleCount} onClick={() => save({ nameColor: undefined, customColor: undefined, roleColors: undefined })}><Icon.reset /></button>
        </div>
      </Row>
      <NamePreview platform={p} prefs={prefs} />
      <button className="sub-fold" aria-expanded={rolesOpen} onClick={() => setRolesOpen(!rolesOpen)}>
        <span>Role Colours{roleCount ? ` · ${roleCount} set` : ''}</span>
        <small>A colour for the broadcaster, mods, VIPs or {p === 'youtube' ? 'members' : 'subs'}, over the one above</small>
        <span className={rolesOpen ? 'chev open' : 'chev'}><Icon.chevron /></span>
      </button>
      {rolesOpen && (
        <div className="role-colors">
          {NAME_ROLES.filter((r) => !(p === 'youtube' && r.role === 'vip')).map((r) => {
            const c = roleColors[r.role]
            return (
              <div key={r.role} className="role-color">
                <span>{p === 'youtube' && r.youtube ? r.youtube : r.label}</span>
                {c && <input type="color" aria-label={`${r.label} colour`} value={c} onChange={(e) => setRole(r.role, e.target.value)} />}
                <Toggle label={`Own colour for ${r.label}`} on={!!c} onChange={(v) => setRole(r.role, v ? '#ffc53d' : null)} />
              </div>
            )
          })}
        </div>
      )}
      </div>

      <div className="pf-col">
      <h4 className="pf-sub">Events</h4>
      <p className="hint pf-hint">Chat puts a card in chat. Events tab lists it there and lets it pop up.</p>
      <EventsTable platform={p} s={s} setEvent={setEvent} resetEvents={resetEvents} />
      </div>
      </div>
    </div>
  )
}

const OTHER_ROWS: [ChatEventGroup, string, string][] = [
  ['donations', 'Tips', 'From StreamElements, Streamlabs and Buy Me a Coffee'],
  ['follows', 'TikTok Follows', 'New TikTok followers'],
  ['subs', 'TikTok Subs', 'TikTok subscriptions and Buy Me a Coffee memberships'],
  ['gifts', 'TikTok Gifts', 'Gifts sent on TikTok LIVE']
]

/** Settings > Chat. Each part folds away; Platforms holds the per-platform options. */
export function ChatSettings({ target }: { target?: string }): JSX.Element {
  const s = useStore((x) => x.settings!)
  const fold = useFolds(target)
  const providers = s.emoteProviders
  const setProvider = (key: keyof typeof providers, on: boolean): void => void updateSettings({ emoteProviders: { ...providers, [key]: on } })
  const ignored = Object.keys(s.ignoredUsers ?? {}).length
  const highlighted = Object.keys(s.highlightedUsers ?? {}).length

  return (
    <>
      <Fold id="messages-settings" title="Messages" desc="Timestamps, history, link previews and spam warnings" {...fold('messages')}>
        <Row title="Show Timestamps" desc="Show the time beside each message">
          <Toggle label="Show timestamps" on={s.showTimestamps} onChange={(v) => void updateSettings({ showTimestamps: v })} />
        </Row>
        <Row title="Keep Chat History" desc="Saves chat from your last 5 streams on this PC, so you can read what you missed. Turning it off deletes it. /clearhistory deletes it too.">
          <Toggle label="Keep chat history" on={s.keepChatHistory ?? true} onChange={(v) => void updateSettings({ keepChatHistory: v })} />
        </Row>
        <Row title="Link Previews" desc="A card with the picture and title under YouTube links and Twitch, Kick or YouTube clip links. The details come from those sites.">
          <Toggle label="Link previews" on={s.linkPreviews ?? true} onChange={(v) => void updateSettings({ linkPreviews: v })} />
        </Row>
        <Row title="Spam Warnings" desc="Marks messages that offer to sell followers or viewers and point to a site, on every platform, with Delete and Ban buttons. Twitch's own held messages and suspicious-user warnings always show.">
          <Toggle label="Spam warnings" on={s.spamWarnings ?? true} onChange={(v) => void updateSettings({ spamWarnings: v })} />
        </Row>
      </Fold>

      <Fold id="platform-settings" title="Platforms" desc="Twitch, YouTube and Kick: username colours and which events show where" {...fold('platforms')}>
        <PlatformPanel s={s} />
      </Fold>

      <Fold id="people-settings" title="Ignored and Highlighted" desc={ignored || highlighted ? `${ignored} ignored · ${highlighted} highlighted. Set from the ⋮ on a message or by right-clicking a name.` : 'Set from the ⋮ on a message or by right-clicking a name. Only on this PC.'} {...fold('people')}>
        <h4 className="marked-head">Ignored, their messages are hidden from chat</h4>
        <MarkedUsers list={s.ignoredUsers ?? {}} empty="Nobody is ignored." remove={(k) => { const next = { ...s.ignoredUsers }; delete next[k]; void updateSettings({ ignoredUsers: next }) }} />
        <h4 className="marked-head">Highlighted, their messages stand out</h4>
        <MarkedUsers list={s.highlightedUsers ?? {}} empty="Nobody is highlighted." remove={(k) => { const next = { ...s.highlightedUsers }; delete next[k]; void updateSettings({ highlightedUsers: next }) }} />
      </Fold>

      <Fold id="emote-settings" title="Emotes" desc="Extra emote sets, shown in chat and in the picker" {...fold('emotes')}>
        <Row title="BetterTTV" desc="Twitch channel and global emotes">
          <Toggle label="BetterTTV" on={providers.bttv} onChange={(v) => setProvider('bttv', v)} />
        </Row>
        <Row title="7TV" desc="Twitch and Kick channel and global emotes">
          <Toggle label="7TV" on={providers.seventv} onChange={(v) => setProvider('seventv', v)} />
        </Row>
        <Row title="FrankerFaceZ" desc="Twitch channel and global emotes">
          <Toggle label="FrankerFaceZ" on={providers.ffz} onChange={(v) => setProvider('ffz', v)} />
        </Row>
      </Fold>
    </>
  )
}

/** Settings > Events & Alerts: pop-ups, the animations over chat, and cards for tips and TikTok. */
export function EventsSettings({ target }: { target?: string }): JSX.Element {
  const s = useStore((x) => x.settings!)
  const fold = useFolds(target)
  return (
    <>
      <Fold id="popup-settings" title="Event Pop-ups" desc="New events rise above the message box, then slide away" {...fold('popups')}>
        <Row title="Show Pop-ups" desc="Hover a pop-up to keep it open, click it to close it now. Events switched off for the Events tab never pop up.">
          <Toggle label="Event pop-ups" on={s.eventPopups ?? true} onChange={(v) => void updateSettings({ eventPopups: v })} />
        </Row>
        {(s.eventPopups ?? true) && (
          <Row title="Pop-up Duration" desc="How long each pop-up stays before it slides away">
            <div className="slider">
              <output>{s.eventPopupSeconds ?? 6} s</output>
              <input type="range" aria-label="Pop-up duration in seconds" min="2" max="30" step="1" value={s.eventPopupSeconds ?? 6} onChange={(e) => void updateSettings({ eventPopupSeconds: Number(e.target.value) })} />
            </div>
          </Row>
        )}
      </Fold>

      <Fold id="animation-settings" title="Animations" desc="Confetti for Twitch follows. Bits, gift boxes and banknotes raining over chat" {...fold('animations')}>
        <p className="anim-note">They play one at a time, in the order the events came in. Drops fall behind the raid, Hype Train and pinned message bars, and nothing shows while Settings is open. Only for events the Events tab shows.</p>
        <div className="anim-kinds">{ANIMATION_KINDS.map((kind) => <div key={kind} className="anim-kind"><AnimationRows kind={kind} s={s} /></div>)}</div>
      </Fold>

      <Fold id="other-events-settings" title="Tips and TikTok" desc="Cards in chat for tips from alert services and for TikTok LIVE" {...fold('other')}>
        {OTHER_ROWS.map(([key, title, desc]) => (
          <Row key={key} title={title} desc={desc}>
            <Toggle label={`${title} in chat`} on={s.chatEvents[key] ?? true} onChange={(v) => void updateSettings({ chatEvents: { ...s.chatEvents, [key]: v } })} />
          </Row>
        ))}
      </Fold>
    </>
  )
}

/**
 * A whole number from 1 to `max`, saved when the field loses focus or on Enter. Anything out of range
 * snaps back into it, an empty or invalid entry goes back to the saved value.
 */
function MinInput({ value, max, unit, label, onChange }: { value: number; max: number; unit: string; label: string; onChange(v: number): void }): JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Math.round(Number(text))
    if (!text.trim() || !Number.isFinite(n)) return setText(String(value))
    const v = Math.min(max, Math.max(1, n))
    setText(String(v))
    if (v !== value) onChange(v)
  }
  return (
    <label className="min-input">
      <input type="number" aria-label={label} min={1} max={max} step={1} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      <span>{unit}</span>
    </label>
  )
}

const ANIMATION_INFO: Record<AnimationKind, { title: string; desc: string; length: string; min?: { title: string; desc: string; unit: string; max: number } }> = {
  follow: {
    title: 'Follows (Twitch)', desc: 'Confetti shoots up from both bottom corners of the window and meets at the top. Only on the All and Twitch tabs.',
    length: 'How long the confetti cannons keep firing. 1 s is a single burst.'
  },
  bits: {
    title: 'Cheers (Twitch Bits)', desc: 'Bits rain down over chat. More Bits, a heavier shower. Only on the All and Twitch tabs.',
    length: 'How long the Bits keep raining.',
    min: { title: 'Smallest Cheer', desc: 'Bits rain for a cheer of at least this many Bits. 1 = every cheer.', unit: 'bits', max: 1000000 }
  },
  gifts: {
    title: 'Gifted Subs (Twitch)', desc: 'Gift boxes rain down over chat for a gift bomb. Bigger bomb, heavier shower. Only on the All and Twitch tabs.',
    length: 'How long the gift boxes keep raining.',
    min: { title: 'Smallest Gift Bomb', desc: 'Gift boxes rain for a gift bomb of at least this many subs.', unit: 'subs', max: 1000 }
  },
  tips: {
    title: 'Tips (StreamElements and Streamlabs)', desc: "Banknotes with the tip's currency sign rain down over chat. Bigger tip, heavier shower. On every tab.",
    length: 'How long the banknotes keep raining.',
    min: { title: 'Smallest Tip', desc: "Banknotes rain for a tip of at least this much, in the tip's own currency (1 = 1 dollar, 1 euro…).", unit: 'or more', max: 100000 }
  }
}

/** On/off, length and smallest amount for one animation. Always all shown, even while it's off. */
function AnimationRows({ kind, s }: { kind: AnimationKind; s: Settings }): JSX.Element {
  const info = ANIMATION_INFO[kind]
  const p = animationPref(s, kind)
  const set = (patch: Partial<typeof p>): void => {
    const all = Object.fromEntries(ANIMATION_KINDS.map((k) => [k, animationPref(s, k)])) as Settings['animations']
    void updateSettings({ animations: { ...all, [kind]: { ...p, ...patch } } })
  }
  return (
    <>
      <h4 className="pf-sub">{info.title}</h4>
      <Row title="Show" desc={info.desc}>
        <Toggle label={`${info.title} animation`} on={p.on} onChange={(on) => set({ on })} />
      </Row>
      <Row title="Length" desc={info.length}>
        <div className="slider">
          <output>{p.seconds} s</output>
          <input type="range" aria-label={`${info.title} animation length in seconds`} min="1" max="30" step="1" value={p.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })} />
        </div>
      </Row>
      {info.min && (
        <Row title={info.min.title} desc={info.min.desc}>
          <MinInput label={info.min.title} unit={info.min.unit} value={p.min} max={info.min.max} onChange={(min) => set({ min })} />
        </Row>
      )}
    </>
  )
}
