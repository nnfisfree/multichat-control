import type { JSX, ReactNode } from 'react'
import type { Platform } from '../../shared/types'

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }): JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{children}</svg>
}

export const PlatformIcon = ({ platform, size }: { platform: Platform; size?: number }): JSX.Element => {
  if (platform === 'twitch') return <Svg size={size}><path d="M5 2 3 6v14h5v3h3l3-3h4l4-4V2H5zm15 13-3 3h-5l-3 3v-3H5V4h15v11zM16 7h-2v6h2V7zm-5 0H9v6h2V7z" /></Svg>
  if (platform === 'youtube') return <Svg size={size}><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12c0 1.6.2 3.3.5 4.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.3-1.5.5-3.2.5-4.8s-.2-3.3-.5-4.8zM9.8 15.3V8.7l5.7 3.3-5.7 3.3z" /></Svg>
  return <Svg size={size}><path d="M3 3h7v5h2V6h2V3h7v7h-3v2h-2v0h2v2h3v7h-7v-3h-2v-2h-2v5H3V3z" /></Svg>
}

const path = (d: string) => (): JSX.Element => <Svg><path d={d} /></Svg>

export const Icon = {
  all: path('M4 4h16v12H7l-3 3V4zm3 4v2h10V8H7zm0 3v2h7v-2H7z'),
  events: path('M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2zM19 16l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z'),
  gear: path('M19.4 13c.1-.3.1-.7.1-1s0-.7-.1-1l2.1-1.6-2-3.5-2.5 1a7 7 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11c-.1.3-.1.7-.1 1s0 .7.1 1l-2.1 1.6 2 3.5 2.5-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.5 1 2-3.5-2.1-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z'),
  menu: path('M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z'),
  send: path('M3 20l18-8L3 4v6l12 2-12 2v6z'),
  smile: path('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8.5 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 18a6 6 0 0 1-5.2-3h10.4a6 6 0 0 1-5.2 3z'),
  bolt: path('M13 2 4 14h6l-1 8 9-12h-6l1-8z'),
  gem: path('M6 3h12l4 6-10 12L2 9l4-6zm1.2 2L5 8.5h14L16.800 5H7.200z'),
  pause: path('M7 5h4v14H7V5zm6 0h4v14h-4V5z'),
  close: path('M6.400 5 12 10.600 17.600 5 19 6.400 13.400 12 19 17.600 17.600 19 12 13.400 6.400 19 5 17.600 10.600 12 5 6.400 6.400 5z'),
  chevron: path('M7 10l5 5 5-5H7z'),
  train: path('M12 2C7.500 2 4 2.500 4 6v10a3 3 0 0 0 3 3l-1.500 2h13L17 19a3 3 0 0 0 3-3V6c0-3.500-3.500-4-8-4zM6 6h12v5H6V6zm2 11a1.500 1.500 0 1 1 0-3 1.500 1.500 0 0 1 0 3zm8 0a1.500 1.500 0 1 1 0-3 1.500 1.500 0 0 1 0 3z'),
  slash: path('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm9.400 3L8 18h2.200l6.400-12h-2.200z'),
  trash: path('M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 12H7L6 9zm4 2v8h1.5v-8H10zm2.500 0v8H14v-8h-1.500z'),
  reply: path('M10 8V4l-7 7 7 7v-4c5 0 8 1.500 11 5-1-6-5-11-11-11z')
}
