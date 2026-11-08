import { useCallback, useEffect, useState, type JSX, type MouseEvent } from 'react'
import type { ActionResult, ChatMessage } from '../../shared/types'
import { ActionDeck } from './components/ActionDeck'
import { ChatList } from './components/ChatList'
import { Composer, type Pop } from './components/Composer'
import { ContextMenu } from './components/ContextMenu'
import { EmotePicker } from './components/EmotePicker'
import { EventsDrawer } from './components/EventsDrawer'
import { HypeBanner } from './components/HypeBanner'
import { RewardsPanel } from './components/RewardsPanel'
import { Settings } from './components/Settings'
import { Tabs, type Tab } from './components/Tabs'
import { TitleBar } from './components/TitleBar'
import { UpdateBanner } from './components/UpdateBanner'
import { setEventsOpen, updateSettings, useFiltered, useInit, useStore } from './store'

export function App(): JSX.Element {
  useInit()
  const ready = useStore((s) => s.ready)
  return ready ? <Main /> : <div className="app"><TitleBar demo={false} /></div>
}

function Main(): JSX.Element {
  const boot = useStore((s) => s.boot!)
  const settings = useStore((s) => s.settings!)
  const messages = useStore((s) => s.messages)
  const [tab, setTab] = useState<Tab>('all')
  const [events, setEvents] = useState(false)
  const [pop, setPop] = useState<Pop>(null)
  const [settingsOpen, setSettingsOpen] = useState(!settings.setupDismissed && !boot.demo)
  const [menu, setMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [insert, setInsert] = useState<{ text: string; n: number } | null>(null)
  const [toast, setToast] = useState<ActionResult | null>(null)
  const shown = useFiltered(messages, tab, settings.chatEvents)

  const openEvents = useCallback((open: boolean) => {
    setEvents(open)
    setEventsOpen(open)
    if (open) setPop(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'o') {
        void updateSettings({ windowOpacity: 1 })
        return
      }
      if (e.key !== 'Escape') return
      if (menu) setMenu(null)
      else if (pop) setPop(null)
      else if (events) openEvents(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [events, menu, pop, openEvents])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.ok ? 2500 : 7000)
    return () => clearTimeout(t)
  }, [toast])

  const onMenu = useCallback((e: MouseEvent, m: ChatMessage) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, m })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  return (
    <div className="app" style={{ '--chat-scale': settings.fontScale, '--ui-font': `"${settings.uiFont}"`, '--chat-font': `"${settings.chatFont}"` } as React.CSSProperties}>
      <TitleBar demo={boot.demo} />
      <UpdateBanner />
      <div className="shell">
        <Tabs tab={tab} eventsOpen={events} onTab={(t) => { setTab(t); openEvents(false) }} onEvents={() => openEvents(!events)} onSettings={() => setSettingsOpen(true)} />
        <main className="stage">
          <HypeBanner tab={tab} />
          <ChatList key={tab} messages={shown} showPlatform={tab === 'all'} showTime={settings.showTimestamps} onMenu={onMenu} />
          <EventsDrawer open={events} onClose={() => openEvents(false)} />
          {toast && <div className={toast.ok ? 'toast good' : 'toast bad'} role="status">{toast.message ?? (toast.ok ? 'Done.' : 'Failed.')}</div>}
        </main>
        <Composer tab={tab} pop={pop} setPop={(p) => { setPop(p); if (p) openEvents(false) }} replyTo={replyTo} clearReply={() => setReplyTo(null)} insert={insert} onSettings={() => setSettingsOpen(true)} />
        {pop === 'emotes' && <EmotePicker scope={replyTo?.platform ?? tab} onPick={(text) => setInsert({ text, n: (insert?.n ?? 0) + 1 })} onClose={() => setPop(null)} />}
        {pop === 'actions' && <ActionDeck scope={tab} onClose={() => setPop(null)} onRewards={() => setPop('rewards')} />}
        {pop === 'rewards' && <RewardsPanel onClose={() => setPop(null)} />}
      </div>
      {menu && <ContextMenu {...menu} onClose={closeMenu} onReply={setReplyTo} onResult={setToast} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
