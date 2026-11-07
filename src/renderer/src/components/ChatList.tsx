import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { Icon } from '../Icons'
import { setHoldHistory } from '../store'
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
  const pausedAt = useRef(0)
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
    if (on) pausedAt.current = messages.length
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

  const resume = (): void => {
    setPause(false)
    toBottom()
  }

  const fresh = paused ? Math.max(0, messages.length - pausedAt.current) : 0

  return (
    <div className="chat-wrap">
      <div className="chat" ref={scroller} onScroll={onScroll} role="log" aria-live="off">
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
