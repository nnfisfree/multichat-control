import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { ChatMessage } from '../../shared/types'
import { Icon } from './Icons'
import { loadOlderHistory, setHoldHistory, useStore } from '../lib/store'
import { ChatRow } from './ChatRow'

const AT_BOTTOM_PX = 40

interface Props {
  messages: ChatMessage[]
  showPlatform: boolean
  showTime: boolean
  onMenu(e: MouseEvent, m: ChatMessage): void
}

export function ChatList({ messages, showPlatform, showTime, onMenu }: Props): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  /** The newest message when reading started, so only later messages count as new. */
  const pausedAt = useRef<string | undefined>(undefined)
  /** Distance from the bottom to keep while older chat is added on top. */
  const anchor = useRef<number | null>(null)
  const programmatic = useRef(false)

  const v = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 36,
    overscan: 12,
    getItemKey: (i) => messages[i].id
  })

  const toBottom = useCallback(() => {
    const el = scroller.current
    if (!el) return
    programmatic.current = true
    el.scrollTop = el.scrollHeight
    requestAnimationFrame(() => { programmatic.current = false })
  }, [])

  const setPause = useCallback((on: boolean) => {
    pausedRef.current = on
    setHoldHistory(on)
    if (on) pausedAt.current = messages.at(-1)?.id
    setPaused(on)
  }, [messages.length])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el || programmatic.current) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX
    if (bottom && pausedRef.current) setPause(false)
    else if (!bottom && !pausedRef.current) setPause(true)
  }

  // Row heights settle after measuring, so keep pinning across the frames that follow.
  useLayoutEffect(() => {
    if (pausedRef.current) return
    toBottom()
    const raf = requestAnimationFrame(toBottom)
    return () => cancelAnimationFrame(raf)
  }, [messages.length, toBottom, v.getTotalSize()])

  useEffect(() => () => setHoldHistory(false), [])

  // Older chat was added on top: keep the same lines in view while the new rows are measured.
  useLayoutEffect(() => {
    const el = scroller.current
    if (anchor.current === null || !el) return
    const keep = anchor.current
    const apply = (): void => { el.scrollTop = el.scrollHeight - keep }
    apply()
    let frames = 0
    const tick = (): void => {
      apply()
      if (++frames < 6) raf = requestAnimationFrame(tick)
      else anchor.current = null
    }
    let raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [messages[0]?.id])

  const resume = (): void => {
    setPause(false)
    toBottom()
  }

  const older = useStore((s) => s.historySessions[s.historySessions.length - 1 - s.historyShown])
  const loadOlder = (): void => {
    // Older chat goes on top, so the view stays where the user is reading.
    setPause(true)
    const el = scroller.current
    if (el) anchor.current = el.scrollHeight - el.scrollTop
    void loadOlderHistory()
  }

  const fresh = (() => {
    if (!paused || !pausedAt.current) return 0
    for (let i = messages.length - 1, n = 0; i >= 0; i--, n++) if (messages[i].id === pausedAt.current) return n
    return 0
  })()

  return (
    <div className="chat-wrap">
      <div className="chat" ref={scroller} onScroll={onScroll} role="log" aria-live="off">
        {older && (
          <button className="history-older" onClick={loadOlder}>
            Show the stream before: {new Date(older.start).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {older.count.toLocaleString()} messages
          </button>
        )}
        {messages.length === 0 && <div className="empty">Waiting for chat…</div>}
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => (
            <div key={it.key} data-index={it.index} ref={v.measureElement} className="row-slot" style={{ transform: `translateY(${it.start}px)` }}>
              <ChatRow m={messages[it.index]} showPlatform={showPlatform} showTime={showTime} onMenu={onMenu} />
            </div>
          ))}
        </div>
      </div>
      {paused && (
        <button className="paused" onClick={resume}>
          <Icon.pause /> <b>Paused</b> {fresh} new message{fresh === 1 ? '' : 's'} <Icon.chevron />
        </button>
      )}
    </div>
  )
}
