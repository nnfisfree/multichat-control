import { useCallback, useEffect, useState, type JSX, type MouseEvent, useMemo } from 'react'
import type { ActionResult, ChatMessage, Platform, UserEntry } from '../shared/types'
import { ActionDeck } from './components/ActionDeck'
import { ChatList } from './components/ChatList'
import { Composer, type Pop } from './components/Composer'
import { ContextMenu } from './components/ContextMenu'
import { EmotePicker } from './components/EmotePicker'
import { EventsDrawer } from './components/EventsDrawer'
import { UsersDrawer } from './components/UsersDrawer'
import { UserCardPanel } from './components/UserCard'
import { ClosePrompt } from './components/ClosePrompt'
import { PinnedBar } from './components/PinnedBar'
import { RaidBar } from './components/RaidBar'
import { HypeBanner } from './components/HypeBanner'
import { RewardsPanel } from './components/RewardsPanel'
import { Settings } from './components/Settings'
import { Tabs, type Tab } from './components/Tabs'
import { TitleBar } from './components/TitleBar'
import { UpdateBanner } from './components/UpdateBanner'
import { applySkin } from './styles/skins'
import { setEventsOpen, updateSettings, useFiltered, useInit, useStore } from './lib/store'

export function App(): JSX.Element {
  useInit()
  const ready = useStore((s) => s.ready)
  return ready ? <Main /> : <div className="app"><TitleBar demo={false} /></div>
}

function Main(): JSX.Element {
  const boot = useStore((s) => s.boot!)
  const settings = useStore((s) => s.settings!)
  const messages = useStore((s) => s.messages)
  useEffect(() => applySkin(settings.theme), [settings.theme])
  const [tab, setTab] = useState<Tab>('all')
  const [events, setEvents] = useState(false)
  const [users, setUsers] = useState(false)
  const [card, setCard] = useState<{ platform: Platform; user: UserEntry; x: number; y: number } | null>(null)
  const [pop, setPop] = useState<Pop>(null)
  const [settingsOpen, setSettingsOpen] = useState<boolean | 'obs'>(!settings.setupDismissed && !boot.demo)
  const [menu, setMenu] = useState<{ x: number; y: number; m: ChatMessage; userOnly?: boolean } | null>(null)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [insert, setInsert] = useState<{ text: string; n: number } | null>(null)
  const [toast, setToast] = useState<ActionResult | null>(null)
  const history = useStore((s) => s.history)
  const all = useMemo(() => (history.length ? [...history, ...messages] : messages), [history, messages])
  const shown = useFiltered(all, tab, settings.chatEvents)

  const openEvents = useCallback((open: boolean) => {
    setEvents(open)
    setEventsOpen(open)
    if (open) { setPop(null); setUsers(false) }
  }, [])
  const openUsers = useCallback((open: boolean) => {
    setUsers(open)
    if (open) { setPop(null); setEvents(false); setEventsOpen(false) }
  }, [])
  // A name in the users list gets the same moderation menu as a chat message.
  const onUser = useCallback((e: MouseEvent, platform: Platform, u: UserEntry, broadcaster: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, userOnly: true, m: { id: `user-${u.id}`, platform, ts: 0, kind: 'chat', parts: [], author: { id: u.id, name: u.name, login: u.login, badges: [], isBroadcaster: broadcaster } } })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'o') {
        void updateSettings({ windowOpacity: 1 })
        return
      }
      if (e.key !== 'Escape') return
      if (menu) setMenu(null)
      else if (card) setCard(null)
      else if (pop) setPop(null)
      else if (events) openEvents(false)
      else if (users) openUsers(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [events, users, menu, card, pop, openEvents, openUsers])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.ok ? 2500 : 7000)
    return () => clearTimeout(t)
  }, [toast])

  // The card opens where the click was.
  const openCard = useCallback((m: ChatMessage, x: number, y: number) => {
    setMenu(null)
    setCard({ platform: m.platform, x, y, user: { id: m.author.id, name: m.author.name, login: m.author.login, color: m.author.color } })
  }, [])
  // Clicking a name opens the user card; right-clicking a message opens the moderation menu.
  const onMenu = useCallback((e: MouseEvent, m: ChatMessage) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'click' && m.author.id) return openCard(m, e.clientX, e.clientY)
    setMenu({ x: e.clientX, y: e.clientY, m })
  }, [openCard])

  const closeMenu = useCallback(() => setMenu(null), [])

  return (
    <div className="app" style={{ '--chat-scale': settings.fontScale, '--ui-font': `"${settings.uiFont}"`, '--chat-font': `"${settings.chatFont}"` } as React.CSSProperties}>
      <TitleBar demo={boot.demo} onObsSettings={() => setSettingsOpen('obs')} />
      <UpdateBanner />
      <div className="shell">
        <Tabs tab={tab} eventsOpen={events} usersOpen={users} onUsers={() => openUsers(!users)} onTab={(t) => { setTab(t); openEvents(false); openUsers(false) }} onEvents={() => openEvents(!events)} onSettings={() => setSettingsOpen(true)} />
        <main className="stage">
          {(tab === 'all' || tab === 'twitch') && <RaidBar />}
          <HypeBanner tab={tab} />
          {(tab === 'all' || tab === 'twitch') && <PinnedBar />}
          <ChatList key={tab} messages={shown} showPlatform={tab === 'all'} showTime={settings.showTimestamps} onMenu={onMenu} />
          <EventsDrawer open={events} onClose={() => openEvents(false)} />
          <UsersDrawer open={users} onClose={() => openUsers(false)} onUser={onUser} onCard={(platform, u, x, y) => setCard({ platform, user: u, x, y })} />
          {toast && <div className={toast.ok ? 'toast good' : 'toast bad'} role="status">{toast.message ?? (toast.ok ? 'Done.' : 'Failed.')}</div>}
        </main>
        <Composer tab={tab} pop={pop} setPop={(p) => { setPop(p); if (p) { openEvents(false); openUsers(false) } }} replyTo={replyTo} clearReply={() => setReplyTo(null)} insert={insert} onSettings={() => setSettingsOpen(true)} onOpenUser={(u) => setCard({ platform: 'twitch', user: u, x: window.innerWidth / 2 - 210, y: 120 })} />
        {pop === 'emotes' && <EmotePicker scope={replyTo?.platform ?? tab} onPick={(text) => setInsert({ text, n: (insert?.n ?? 0) + 1 })} onClose={() => setPop(null)} />}
        {pop === 'actions' && <ActionDeck scope={tab} onClose={() => setPop(null)} onRewards={() => setPop('rewards')} />}
        {pop === 'rewards' && <RewardsPanel onClose={() => setPop(null)} />}
      </div>
      {menu && <ContextMenu {...menu} onClose={closeMenu} onReply={setReplyTo} onResult={setToast} onCard={menu.m.author.id ? (m) => openCard(m, menu.x, menu.y) : undefined} />}
      {card && <UserCardPanel platform={card.platform} user={card.user} x={card.x} y={card.y} onClose={() => setCard(null)} onReply={setReplyTo} onResult={setToast} />}
      {settingsOpen && <Settings focus={settingsOpen === 'obs' ? 'obs' : undefined} onClose={() => setSettingsOpen(false)} />}
      <ClosePrompt />
    </div>
  )
}
