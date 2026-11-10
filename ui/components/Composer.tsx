import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { PLATFORMS, PLATFORM_LABEL, type ChatMessage, type Platform, type SendResult, type UserEntry } from '../../shared/types'
import { composerPlaceholder, plainText } from '../../shared/parts'
import { ALL_COMMANDS, findCommand, isTwitchCommand, matchCommands } from '../lib/commands'
import { Icon, PlatformIcon } from './Icons'
import { connected, updateSettings, useStore } from '../lib/store'
import type { Tab } from './Tabs'

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
  const [text, setText] = useState('')
  const [results, setResults] = useState<SendResult[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const statuses = useStore((s) => s.statuses)
  const targets = useStore((s) => s.settings!.sendTargets)

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

  const pick = (name: string): void => {
    setText(`${name} `)
    setPop(null)
    requestAnimationFrame(() => input.current?.focus())
  }
  const suggestions = matchCommands(text)
  const commandList = pop === 'commands' ? ALL_COMMANDS : suggestions

  const placeholder = replyTo ? `Reply to ${replyTo.author.name}…`
    : composerPlaceholder(tab, destinations, PLATFORMS.some((p) => connected(statuses, p)))

  return (
    <footer className="composer-wrap">
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
        <button className={pop === 'menu' ? 'icon-btn on' : 'icon-btn'} aria-label="Menu" onClick={() => setPop(pop === 'menu' ? null : 'menu')}><Icon.menu /></button>
        <button className={pop === 'rewards' ? 'icon-btn on' : 'icon-btn'} aria-label="Twitch rewards and Power-ups" title="Twitch Rewards & Power-ups" onClick={() => setPop(pop === 'rewards' ? null : 'rewards')}><Icon.gem /></button>
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
        <button className={pop === 'emotes' ? 'icon-btn on' : 'icon-btn'} aria-label="Emotes" title="Emotes" onClick={() => setPop(pop === 'emotes' ? null : 'emotes')}><Icon.smile /></button>
        <button className={pop === 'commands' ? 'icon-btn on' : 'icon-btn'} aria-label="Commands" title="Commands" onClick={() => setPop(pop === 'commands' ? null : 'commands')}><Icon.slash /></button>
        <button className={pop === 'actions' ? 'icon-btn on' : 'icon-btn'} aria-label="Actions" title="Quick actions" onClick={() => setPop(pop === 'actions' ? null : 'actions')}><Icon.bolt /></button>
        <button className="send" aria-label="Send" disabled={!text.trim() || (!findCommand(text) && (busy || !destinations.length))} onClick={() => void send()}><Icon.send /></button>
      </div>
      {commandList.length > 0 && (
        <div className="popover commands" role="menu" aria-label="Commands">
          <h3>Commands</h3>
          <p className="commands-hint">Type them in the message box. They run in this app: Twitch commands go straight to Twitch, and none are posted as chat text.</p>
          <div className="commands-list">
            {commandList.map((c) => (
              <button key={c.name} role="menuitem" onClick={() => pick(c.name)}>
                <code>{c.usage}</code>
                {c.twitch && <span className="cmd-tag">Twitch</span>}
                {c.app && <span className="cmd-tag app" title="Runs in this app only">App</span>}
                <small>{c.description}</small>
              </button>
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
