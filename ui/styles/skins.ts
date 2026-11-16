/**
 * Skins. Each one swaps the colour variables; the window edge gradient (--edge) is never touched,
 * so every skin keeps the same frame. Palettes are borrowed from popular open-source themes,
 * credited in `by`.
 */
export interface Skin {
  id: string
  name: string
  by: string
  /** Preview card colours: background, panel, accent, second accent. */
  swatch: [string, string, string, string]
  vars: Record<string, string>
  /** Light skin (dark text on a pale window). theme.css swaps the dark translucent fills for light ones. */
  light?: boolean
}

// "#rrggbb" -> "r, g, b" for use inside rgba()
const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

interface Palette {
  bg: string; bgDeep: string; window: string; solid: string; solid2: string
  accent: string; accent2: string; second: string; second2: string
  text: string; muted: string; onAccent: string
  warn: string; good: string; bad: string; line?: string; hype?: string
  /** Window buttons: minimize, maximize, close, and the glyph colour. */
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
  // pastel accents need a lighter banner so the text stays readable
  '--hype-bg': p.hype ?? `linear-gradient(90deg, rgba(${rgb(p.accent)}, 0.42), rgba(${rgb(p.second)}, 0.3))`
})

// The first skin is the default for new installs and the fallback for unknown ids.
export const SKINS: Skin[] = [
  {
    id: 'sweet', name: 'Sweet', by: 'Sweet by EliverLara',
    swatch: ['#161925', '#1f2233', '#c74ded', '#00c1e4'],
    vars: make({
      bg: '#161925', bgDeep: '#10121b', window: 'linear-gradient(135deg, #10121b, #161925 45%, #221a3d 80%, #2c1640)',
      solid: '#13151f', solid2: '#1f2233', accent: '#c74ded', accent2: '#dc7ef5', second: '#00c1e4', second2: '#5fe0f5',
      text: '#ebedf5', muted: '#a9adc4', onAccent: '#10121b', warn: '#f9a03f', good: '#00e8c6', bad: '#ff3d71',
      line: 'rgba(199, 77, 237, 0.2)',
      hype: 'linear-gradient(90deg, rgba(199, 77, 237, 0.6), rgba(255, 61, 113, 0.4))',
      win: ['#f9dc5c', '#00e8c6', '#ff3d71', '#10121b']
    })
  },
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
    id: 'butterfly', name: 'Butterfly', by: 'For Michelle the 🦋', light: true,
    swatch: ['#ffdef4', '#bde5d6', '#d9479f', '#2fa585'],
    vars: {
      ...make({
        bg: '#ffdef4', bgDeep: '#fbe6f3', window: 'linear-gradient(180deg, #ffdef4, #fde1f3 38%, #d6e3dd 56%, #c4e6d9 70%, #bde5d6)',
        solid: '#fff2fa', solid2: '#ffe6f5', accent: '#d9479f', accent2: '#e868b3', second: '#2fa585', second2: '#1f8a6d',
        text: '#3e2242', muted: '#7d5d7b', onAccent: '#ffffff', warn: '#d97706', good: '#159a72', bad: '#e0335f',
        line: 'rgba(125, 60, 115, 0.2)',
        hype: 'linear-gradient(90deg, rgba(255, 170, 222, 0.95), rgba(150, 218, 192, 0.95))',
        win: ['#5fc4a3', '#8dd5ba', '#e86bb5', '#ffffff']
      }),
      '--surface': 'rgba(255, 255, 255, 0.45)',
      '--surface-2': 'rgba(255, 255, 255, 0.7)'
    }
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
    id: 'kanagawa', name: 'Kanagawa', by: 'Kanagawa by rebelot',
    swatch: ['#1f1f28', '#2a2a37', '#957fb8', '#7e9cd8'],
    vars: make({
      bg: '#1f1f28', bgDeep: '#16161d', window: 'linear-gradient(135deg, #16161d, #1f1f28 50%, #2a2a37)',
      solid: '#1a1a22', solid2: '#2a2a37', accent: '#957fb8', accent2: '#b39ddb', second: '#7e9cd8', second2: '#7fb4ca',
      text: '#dcd7ba', muted: '#b4b0a0', onAccent: '#16161d', warn: '#ffa066', good: '#98bb6c', bad: '#ff5d62',
      line: 'rgba(220, 215, 186, 0.14)',
      win: ['#e6c384', '#98bb6c', '#e46876', '#16161d']
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
    id: 'catppuccin-latte', name: 'Catppuccin Latte', by: 'catppuccin.com', light: true,
    swatch: ['#eff1f5', '#ccd0da', '#8839ef', '#1e66f5'],
    vars: {
      ...make({
        bg: '#eff1f5', bgDeep: '#e6e9ef', window: 'linear-gradient(135deg, #e6e9ef, #eff1f5 50%, #e8e6f4 80%, #e3e8f6)',
        solid: '#f8f9fb', solid2: '#e6e9ef', accent: '#8839ef', accent2: '#9d5cf2', second: '#1e66f5', second2: '#209fb5',
        text: '#4c4f69', muted: '#6c6f85', onAccent: '#ffffff', warn: '#fe640b', good: '#40a02b', bad: '#d20f39',
        line: 'rgba(76, 79, 105, 0.18)',
        hype: 'linear-gradient(90deg, rgba(203, 166, 247, 0.9), rgba(137, 180, 250, 0.85))',
        win: ['#df8e1d', '#40a02b', '#d20f39', '#ffffff']
      }),
      '--surface': 'rgba(255, 255, 255, 0.5)',
      '--surface-2': 'rgba(255, 255, 255, 0.75)'
    }
  },
  {
    id: 'everforest-light', name: 'Everforest Light', by: 'Everforest by sainnhe', light: true,
    swatch: ['#fdf6e3', '#e6e2cc', '#8da101', '#3a94c5'],
    vars: {
      ...make({
        bg: '#fdf6e3', bgDeep: '#efebd4', window: 'linear-gradient(135deg, #efebd4, #fdf6e3 50%, #f4f0d9 80%, #e9eccf)',
        solid: '#fffbef', solid2: '#f4f0d9', accent: '#8da101', accent2: '#93b259', second: '#3a94c5', second2: '#35a77c',
        text: '#5c6a72', muted: '#829181', onAccent: '#ffffff', warn: '#f57d26', good: '#35a77c', bad: '#f85552',
        line: 'rgba(92, 106, 114, 0.2)',
        hype: 'linear-gradient(90deg, rgba(167, 192, 128, 0.85), rgba(127, 187, 179, 0.75))',
        win: ['#dfa000', '#8da101', '#f85552', '#fdf6e3']
      }),
      '--surface': 'rgba(255, 255, 255, 0.45)',
      '--surface-2': 'rgba(255, 255, 255, 0.7)'
    }
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

/** Applies a skin's colours to the page. Leaves the edge gradient alone. */
export function applySkin(id: string | undefined): void {
  const root = document.documentElement
  const vars = skinById(id).vars
  // drop extras a previous skin set (light skins add --surface etc.) so the stylesheet defaults come back
  for (const s of SKINS) for (const k of Object.keys(s.vars)) if (!(k in vars)) root.style.removeProperty(k)
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.dataset.skin = skinById(id).id
  root.dataset.tone = skinById(id).light ? 'light' : 'dark'
}
