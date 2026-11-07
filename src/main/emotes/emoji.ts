import type { Emote, Platform } from '../../shared/types'

const SETS: Record<string, string> = {
  Smileys: '😀 😂 🤣 😊 😍 😘 😎 🤩 🥳 😭 😡 🤔 🙄 😴 🤯 😱 🥺 😅 😈 💀 🤡',
  Gestures: '👍 👎 👏 🙌 🙏 💪 🤝 ✌️ 🤞 🤘 👌 👋 🫡 🫶',
  Hearts: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 💔',
  Objects: '🔥 ⭐ ✨ 🎉 🎊 🏆 🎮 🕹️ 🎧 🎵 🎶 💯 💥 💎 👑 🚀 ⚡ 🍕 🍺 ☕'
}

/** YouTube's API exposes no custom emoji, so its picker offers standard emoji. */
export function emojiSet(platform: Platform): Emote[] {
  return Object.entries(SETS).flatMap(([group, list]) => list.split(' ').map((name) => ({
    id: name, name, url: '', provider: 'emoji' as const, platform, group
  })))
}
