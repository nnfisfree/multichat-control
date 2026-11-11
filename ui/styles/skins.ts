/**
 * Skins. Each one swaps the app's colour variables; the window edge gradient (--edge) is never
 * touched, so every skin keeps the same frame. Palettes come from popular open-source (MIT)
 * themes, credited in `by`.
 */
export interface Skin {
  id: string
  name: string
  by: string
  /** Four colours for the preview card: background, panel, accent, second accent. */
  swatch: [string, string, string, string]
  vars: Record<string, string>
}

/** "r, g, b" for use inside rgba(). */
const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

interface Palette {
  bg: string; bgDeep: string; window: string; solid: string; solid2: string
  accent: string; accent2: string; second: string; second2: string
  text: string; muted: string; onAccent: string
  warn: string; good: string; bad: string; line?: string; hype?: string
  /** Window buttons: minimise, maximise, close, and the colour of their symbols. */
  win?: [string, string, string, string]
}

const make = (p: Palette): Record<string, string> => ({
  '--bg': p.bgDeep,
  '--window': p.window,
  '--solid': p.solid,
  '--solid-2': p.solid2,
  '--purple': p.accent,
  '--purple-2': p.accent2,
  '--blue': p.second,
  '--blue-2': p.second2,
  '--purple-rgb': rgb(p.accent),
  '--blue-rgb': rgb(p.second),
  '--text': p.text,
  '--muted': p.muted,
  '--on-accent': p.onAccent,
  '--orange': p.warn,
  '--good': p.good,
  '--bad': p.bad,
  '--line': p.line ?? 'rgba(255, 255, 255, 0.16)',
  '--win-min': (p.win ?? [p.second])[0],
  '--win-max': (p.win ?? [p.second, p.second])[1],
  '--win-close': (p.win ?? [p.second, p.second, p.accent])[2],
  '--win-glyph': (p.win ?? [0, 0, 0, p.onAccent])[3] as string,
  // Pastel accents need a lighter banner so its text stays readable.
  '--hype-bg': p.hype ?? `linear-gradient(90deg, rgba(${rgb(p.accent)}, 0.42), rgba(${rgb(p.second)}, 0.3))`
})

export const SKINS: Skin[] = [
  {
    id: 'pos', name: 'POS Club', by: 'The original NoName look',
    swatch: ['#090b3f', '#1e1180', '#8d1fc8', '#27a9e8'],
    vars: make({
      bg: '#090b3f', bgDeep: '#090b3f', window: 'linear-gradient(135deg, #090b3f, #120d5c 45%, #1e1180 75%, #163a9c)',
      solid: '#100c50', solid2: '#171268', accent: '#8d1fc8', accent2: '#a838e0', second: '#27a9e8', second2: '#52bff2',
      text: '#ffffff', muted: '#b7b9d8', onAccent: '#ffffff', warn: '#ffb347', good: '#34e39f', bad: '#ff6b81',
      hype: 'linear-gradient(90deg, rgba(141, 31, 200, 0.75), rgba(39, 100, 232, 0.6))'
    })
  },
  {
    id: 'myst-bourne', name: 'Myst Bourne', by: 'For Alex, my sis ❤️',
    swatch: ['#1c0638', '#3b0f73', '#a855f7', '#f0e2ff'],
    vars: make({
      bg: '#1c0638', bgDeep: '#14042a', window: 'linear-gradient(135deg, #14042a, #2a0957 40%, #45108f 75%, #6a1fb8)',
      solid: '#220748', solid2: '#2f0c61', accent: '#9d3ff0', accent2: '#b366ff', second: '#c06cf5', second2: '#d496ff',
      text: '#ffffff', muted: '#dcc6fa', onAccent: '#ffffff', warn: '#ffc46b', good: '#5eebb0', bad: '#ff6b9a',
      line: 'rgba(240, 226, 255, 0.2)',
      hype: 'linear-gradient(90deg, rgba(157, 63, 240, 0.8), rgba(240, 226, 255, 0.28))',
      win: ['#f0e2ff', '#d9b8ff', '#c06cf5', '#2a0957']
    })
  },
  {
    id: 'dracula', name: 'Dracula', by: 'draculatheme.com',
    swatch: ['#282a36', '#44475a', '#bd93f9', '#ff79c6'],
    vars: make({
      bg: '#282a36', bgDeep: '#1e1f29', window: 'linear-gradient(135deg, #1e1f29, #282a36 50%, #2f3142)',
      solid: '#21222c', solid2: '#2c2e3d', accent: '#bd93f9', accent2: '#d0b0ff', second: '#ff79c6', second2: '#8be9fd',
      text: '#f8f8f2', muted: '#a4abd0', onAccent: '#1e1f29', warn: '#ffb86c', good: '#50fa7b', bad: '#ff5555',
      line: 'rgba(189, 147, 249, 0.2)',
      win: ['#f1fa8c', '#50fa7b', '#ff5555', '#21222c']
    })
  },
  {
    id: 'catppuccin', name: 'Catppuccin Mocha', by: 'catppuccin.com',
    swatch: ['#1e1e2e', '#313244', '#cba6f7', '#89b4fa'],
    vars: make({
      bg: '#1e1e2e', bgDeep: '#11111b', window: 'linear-gradient(135deg, #181825, #1e1e2e 55%, #24243a)',
      solid: '#181825', solid2: '#252537', accent: '#cba6f7', accent2: '#ddc4fb', second: '#89b4fa', second2: '#89dceb',
      text: '#cdd6f4', muted: '#a6adc8', onAccent: '#11111b', warn: '#fab387', good: '#a6e3a1', bad: '#f38ba8',
      line: 'rgba(205, 214, 244, 0.14)',
      win: ['#f9e2af', '#a6e3a1', '#f38ba8', '#11111b']
    })
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night', by: 'Tokyo Night by enkia',
    swatch: ['#1a1b26', '#292e42', '#bb9af7', '#7aa2f7'],
    vars: make({
      bg: '#1a1b26', bgDeep: '#16161e', window: 'linear-gradient(135deg, #16161e, #1a1b26 50%, #1f2335)',
      solid: '#16161e', solid2: '#222436', accent: '#bb9af7', accent2: '#cdb4ff', second: '#7aa2f7', second2: '#7dcfff',
      text: '#c0caf5', muted: '#a9b1d6', onAccent: '#16161e', warn: '#ff9e64', good: '#9ece6a', bad: '#f7768e',
      line: 'rgba(122, 162, 247, 0.18)',
      win: ['#e0af68', '#9ece6a', '#f7768e', '#16161e']
    })
  },
  {
    id: 'nord', name: 'Nord', by: 'nordtheme.com',
    swatch: ['#2e3440', '#3b4252', '#88c0d0', '#81a1c1'],
    vars: make({
      bg: '#2e3440', bgDeep: '#272c36', window: 'linear-gradient(135deg, #272c36, #2e3440 50%, #343b49)',
      solid: '#2a303b', solid2: '#3b4252', accent: '#81a1c1', accent2: '#9cb5d0', second: '#88c0d0', second2: '#8fbcbb',
      text: '#eceff4', muted: '#c0c8d6', onAccent: '#242933', warn: '#ebcb8b', good: '#a3be8c', bad: '#bf616a',
      line: 'rgba(216, 222, 233, 0.16)',
      win: ['#ebcb8b', '#a3be8c', '#bf616a', '#2e3440']
    })
  },
  {
    id: 'gruvbox', name: 'Gruvbox Dark', by: 'Gruvbox by morhetz',
    swatch: ['#282828', '#3c3836', '#fe8019', '#fabd2f'],
    vars: make({
      bg: '#282828', bgDeep: '#1d2021', window: 'linear-gradient(135deg, #1d2021, #282828 55%, #32302f)',
      solid: '#1d2021', solid2: '#32302f', accent: '#fe8019', accent2: '#ff9a45', second: '#fabd2f', second2: '#8ec07c',
      text: '#ebdbb2', muted: '#bdae93', onAccent: '#1d2021', warn: '#fabd2f', good: '#b8bb26', bad: '#fb4934',
      line: 'rgba(235, 219, 178, 0.15)',
      win: ['#fabd2f', '#b8bb26', '#fb4934', '#1d2021']
    })
  },
  {
    id: 'rose-pine', name: 'Rosé Pine', by: 'rosepinetheme.com',
    swatch: ['#191724', '#26233a', '#c4a7e7', '#ebbcba'],
    vars: make({
      bg: '#191724', bgDeep: '#13111c', window: 'linear-gradient(135deg, #13111c, #191724 50%, #1f1d2e)',
      solid: '#1f1d2e', solid2: '#26233a', accent: '#c4a7e7', accent2: '#d6c0f0', second: '#ebbcba', second2: '#9ccfd8',
      text: '#e0def4', muted: '#a9a5c4', onAccent: '#191724', warn: '#f6c177', good: '#8fd6a6', bad: '#eb6f92',
      line: 'rgba(224, 222, 244, 0.14)',
      win: ['#f6c177', '#9ccfd8', '#eb6f92', '#191724']
    })
  },
  {
    id: 'oled', name: 'OLED Black', by: 'Pure black, made for this app',
    swatch: ['#000000', '#141414', '#8d1fc8', '#27a9e8'],
    vars: make({
      bg: '#000000', bgDeep: '#000000', window: '#000000',
      solid: '#0a0a0a', solid2: '#161616', accent: '#9a2ad6', accent2: '#b04ae6', second: '#27a9e8', second2: '#5cc4f5',
      text: '#ffffff', muted: '#a8a8b3', onAccent: '#ffffff', warn: '#ffb347', good: '#34e39f', bad: '#ff6b81',
      line: 'rgba(255, 255, 255, 0.14)'
    })
  }
]

export const skinById = (id: string | undefined): Skin => SKINS.find((s) => s.id === id) ?? SKINS[0]

/** Puts a skin's colours on the page. The edge gradient is left alone. */
export function applySkin(id: string | undefined): void {
  const root = document.documentElement
  for (const [k, v] of Object.entries(skinById(id).vars)) root.style.setProperty(k, v)
  root.dataset.skin = skinById(id).id
}
