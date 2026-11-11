import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { PLATFORMS, PLATFORM_LABEL, type ChatMessage, type Platform, type SendResult, type UserEntry } from '../../shared/types'
import { composerPlaceholder, plainText } from '../../shared/parts'
import { allCommands, COMMAND_GROUPS, findCommand, findSbAction, isSbCommand, isTwitchCommand, matchCommands, SB_PREFIX, type CommandGroup, type CommandInfo } from '../lib/commands'
import { ChannelStatsBar } from './ChannelStats'
import { Clock } from './Clock'
import { AppLogo, Icon, PlatformIcon, StreamerbotLogo } from './Icons'
import { connected, updateSettings, useStore } from '../lib/store'
import type { Tab } from './Tabs'

const GROUP_HEAD: Record<CommandGroup, { label: string; icon: ReactNode }> = {
  twitch: { label: 'Twitch', icon: <PlatformIcon platform="twitch" size={16} /> },
  app: { label: 'Multichat Control', icon: <AppLogo size={16} /> },
  streamerbot: { label: 'Streamer.bot', icon: <StreamerbotLogo size={16} /> }
}

export type Pop = 'emotes' | 'actions' | 'rewards' | 'menu' | 'commands' | null

interface Props {
  tab: Tab
  pop: Pop
  setPop(p: Pop): void
  replyTo: ChatMessage | null
  clearReply(): void
  /** Set by the picker; consumed once. */
  insert: { text: string; n: number } | null
  onSettings(): void
  /** /user name opens their user card. */
  onOpenUser(user: UserEntry): void
}

export function Composer({ tab, pop, setPop, replyTo, clearReply, insert, onSettings, onOpenUser }: Props): JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [results, setResults] = useState<SendResult[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const statuses = useStore((s) => s.statuses)
  const targets = useStore((s) => s.settings!.sendTargets)
  const sb = useStore((s) => s.streamerbot)
  const sbEnabled = useStore((s) => s.settings!.sbEnabled)
  const showClock = useStore((s) => s.settings!.showClock)
  const showStats = useStore((s) => s.settings!.showStats ?? true)
  // The row under the message box holds the stats (middle) and the clock (right).
  const footRow = showClock || showStats
  // Popovers above the message box move down when that row is hidden.
  useEffect(() => { document.documentElement.dataset.clock = footRow ? 'on' : 'off' }, [footRow])

  const destinations: Platform[] = replyTo ? [replyTo.platform]
    : tab === 'all' ? PLATFORMS.filter((p) => targets[p] && connected(statuses, p))
    : [tab]

  useEffect(() => {
    if (!insert) return
    const el = input.current
    const at = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const pre = text.slice(0, at)
    const piece = `${pre && !pre.endsWith(' ') ? ' ' : ''}${insert.text} `
    setText(pre + piece + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + piece.length, at + piece.length)
    })
    // Only a new pick should insert; the text it reads is the value at that moment.
  }, [insert?.n])

  useEffect(() => {
    if (replyTo) input.current?.focus()
  }, [replyTo])

  // Opening the commands list starts a fresh search, ready to type into.
  useEffect(() => {
    if (pop !== 'commands') return
    setQuery('')
    requestAnimationFrame(() => search.current?.focus())
  }, [pop])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 5000)
    return () => clearTimeout(t)
  }, [note])

  useEffect(() => {
    if (!results.length) return
    const t = setTimeout(() => setResults([]), results.some((r) => !r.ok) ? 9000 : 2500)
    return () => clearTimeout(t)
  }, [results])

  const send = async (): Promise<void> => {
    const body = text.trim()
    // The app's own commands run here and never reach a platform.
    const command = findCommand(body)
    if (command) {
      setText('')
      setPop(null)
      setNote(await command.run().then((t) => ({ ok: true, text: t }), (e) => ({ ok: false, text: String(e?.message ?? e) })))
      input.current?.focus()
      return
    }
    // Streamer.bot actions run in Streamer.bot, whatever tab is open.
    if (isSbCommand(body)) {
      const found = findSbAction(body, sb.actions)
      if (!found) {
        const name = body.slice(SB_PREFIX.length).trim()
        setNote({ ok: false, text: sb.status !== 'connected' ? 'Streamer.bot is not connected. Turn it on in Settings → Connections.' : name ? `No Streamer.bot action called "${name}".` : 'Type the name of a Streamer.bot action after /sb.' })
        return
      }
      setBusy(true)
      const r = await window.nnf.streamerbot.run(found.action.id, found.input).catch((e) => ({ ok: false, message: String(e?.message ?? e) }))
      setBusy(false)
      setPop(null)
      setNote({ ok: r.ok, text: r.message ?? (r.ok ? 'Done.' : 'Failed.') })
      if (r.ok) setText('')
      input.current?.focus()
      return
    }
    // Twitch's commands run through Twitch's API, whatever tab is open.
    if (isTwitchCommand(body)) {
      setBusy(true)
      const r = await window.nnf.twitchCommand(body).catch((e) => ({ ok: false, message: String(e?.message ?? e) }))
      setBusy(false)
      setPop(null)
      if ('openUser' in r && r.openUser) onOpenUser(r.openUser)
      if (r.message) setNote({ ok: r.ok, text: r.message })
      if (r.ok) setText('')
      input.current?.focus()
      return
    }
    if (body.startsWith('/') && /^\/[a-z]+$/i.test(body.split(/\s+/)[0])) {
      setNote({ ok: false, text: `Unknown command: ${body.split(/\s+/)[0]}. Click the / button to see the list.` })
      return
    }
    if (!body || busy || !destinations.length) return
    setBusy(true)
    const r = await window.nnf.send(destinations, body, replyTo ? { platform: replyTo.platform, messageId: replyTo.id } : undefined)
    setBusy(false)
    setResults(r)
    // Keep the text if nothing went out, so a failed send doesn't lose it.
    if (r.some((x) => x.ok)) {
      setText('')
      clearReply()
    }
    input.current?.focus()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape' && replyTo) clearReply()
  }

  const pick = (c: CommandInfo): void => {
    setText(`${c.insert ?? c.name} `)
    setPop(null)
    requestAnimationFrame(() => input.current?.focus())
  }
  const full = pop === 'commands'
  // Every word typed in the search has to appear in the command, its usage or its description.
  const words = full ? query.toLowerCase().split(/\s+/).filter(Boolean) : []
  const commandList = full
    ? allCommands(sb).filter((c) => { const hay = `${c.usage} ${c.description}`.toLowerCase(); return words.every((w) => hay.includes(w)) })
    : matchCommands(text, sb)
  // In the full list, the Streamer.bot group shows even when empty, to say why.
  const sbNote = !full || words.length || commandList.some((c) => c.group === 'streamerbot') ? null
    : !sbEnabled ? 'Connect Streamer.bot in Settings → Connections to run its actions from here.'
    : sb.status === 'connected' ? 'No actions or chat commands are turned on in Streamer.bot yet.'
    : sb.status === 'error' ? (sb.detail ?? 'Streamer.bot needs attention. See Settings → Connections.')
    : 'Waiting for Streamer.bot…'
  const groups = COMMAND_GROUPS.map((g) => ({ g, items: commandList.filter((c) => c.group === g) }))
    .filter(({ g, items }) => items.length > 0 || (g === 'streamerbot' && sbNote))
  const onSearchKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (query) return setQuery('')
      setPop(null)
      input.current?.focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const first = groups.find((g) => g.items.length)?.items[0]
      if (first) pick(first)
    }
  }

  const placeholder = replyTo ? `Reply to ${replyTo.author.name}…`
    : composerPlaceholder(tab, destinations, PLATFORMS.some((p) => connected(statuses, p)))

  return (
    <footer className={footRow ? 'composer-wrap' : 'composer-wrap no-clock'}>
      {replyTo && (
        <div className="replying">
          <Icon.reply /> Replying to <b>{replyTo.author.name}</b>: <span>{plainText(replyTo.parts)}</span>
          <button className="icon-btn" aria-label="Cancel reply" onClick={clearReply}><Icon.close /></button>
        </div>
      )}
      {note && <div className="send-results" role="status"><span className={note.ok ? 'chip good' : 'chip bad'}>{note.text}</span></div>}
      {results.length > 0 && (
        <div className="send-results" role="status">
          {results.map((r) => (
            <span key={r.platform} className={r.ok ? 'chip good' : 'chip bad'} title={r.error}>
              <PlatformIcon platform={r.platform} size={14} /> {r.ok ? 'Sent' : r.error}
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <button className={pop === 'menu' ? 'icon-btn on' : 'icon-btn'} aria-label="Menu" data-pop-toggle onClick={() => setPop(pop === 'menu' ? null : 'menu')}><Icon.menu /></button>
        <button className={pop === 'commands' ? 'icon-btn on' : 'icon-btn'} aria-label="Commands" title="Commands" data-pop-toggle onClick={() => setPop(pop === 'commands' ? null : 'commands')}><Icon.slash /></button>
        <button className={pop === 'rewards' ? 'icon-btn on' : 'icon-btn'} aria-label="Twitch rewards and Power-ups" title="Twitch Rewards & Power-ups" data-pop-toggle onClick={() => setPop(pop === 'rewards' ? null : 'rewards')}><Icon.gem /></button>
        <textarea ref={input} rows={1} aria-label="Message" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
        {tab === 'all' && !replyTo && (
          <div className="targets">
            {PLATFORMS.map((p) => (
              <button key={p} className={targets[p] ? `pf-toggle on ${p}` : `pf-toggle ${p}`} aria-pressed={targets[p]} disabled={!connected(statuses, p)}
                title={connected(statuses, p) ? `${targets[p] ? 'Sending to' : 'Not sending to'} ${PLATFORM_LABEL[p]}` : `${PLATFORM_LABEL[p]} is not connected`}
                onClick={() => void updateSettings({ sendTargets: { ...targets, [p]: !targets[p] } })}><PlatformIcon platform={p} size={16} /></button>
            ))}
          </div>
        )}
        <button className={pop === 'emotes' ? 'icon-btn on' : 'icon-btn'} aria-label="Emotes" title="Emotes" data-pop-toggle onClick={() => setPop(pop === 'emotes' ? null : 'emotes')}><Icon.smile /></button>
        <button className={pop === 'actions' ? 'icon-btn on' : 'icon-btn'} aria-label="Actions" title="Quick actions" data-pop-toggle onClick={() => setPop(pop === 'actions' ? null : 'actions')}><Icon.bolt /></button>
        <button className="send" aria-label="Send" disabled={!text.trim() || (!findCommand(text) && (busy || (!isSbCommand(text) && !destinations.length)))} onClick={() => void send()}><Icon.send /></button>
      </div>
      {footRow && (
        <div className="clock-row">
          <span className="stats-cell">{showStats && <ChannelStatsBar />}</span>
          <span className="clock-cell">{showClock && <Clock />}</span>
        </div>
      )}
      {(full || groups.length > 0) && (
        <div className="popover commands" role="menu" aria-label="Commands">
          <h3>Commands</h3>
          {full && <p className="commands-hint">Type them in the message box, or click one. Twitch and app commands are never posted as chat text, /sb runs a Streamer.bot action, and ! commands are sent to chat for Streamer.bot to pick up.</p>}
          {full && (
            <label className="users-filter cmd-search">
              <Icon.search />
              <input ref={search} placeholder="Search commands" aria-label="Search commands" spellCheck={false} value={query}
                onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} />
              {query && <button className="cmd-search-clear" aria-label="Clear search" title="Clear search" onClick={() => { setQuery(''); search.current?.focus() }}><Icon.close /></button>}
            </label>
          )}
          <div className="commands-list">
            {full && groups.length === 0 && <p className="cmd-group-note">No commands match "{query.trim()}".</p>}
            {groups.map(({ g, items }) => (
              <section key={g} className="cmd-group" aria-label={GROUP_HEAD[g].label}>
                <h4 className={`cmd-group-head cmd-group-${g}`}>{GROUP_HEAD[g].icon}<span>{GROUP_HEAD[g].label}</span></h4>
                {items.map((c) => (
                  <button key={`${g}:${c.usage}`} role="menuitem" onClick={() => pick(c)}>
                    <code>{c.usage}</code>
                    <small>{c.description}</small>
                  </button>
                ))}
                {g === 'streamerbot' && sbNote && <p className="cmd-group-note">{sbNote}</p>}
              </section>
            ))}
          </div>
        </div>
      )}
      {pop === 'menu' && (
        <div className="popover menu" role="menu">
          <button role="menuitem" onClick={() => { setPop(null); onSettings() }}>Settings &amp; accounts</button>
          <button role="menuitem" onClick={() => setPop('rewards')}>Twitch Rewards &amp; Power-ups</button>
          <button role="menuitem" onClick={() => setPop('actions')}>Quick actions</button>
        </div>
      )}
    </footer>
  )
}
