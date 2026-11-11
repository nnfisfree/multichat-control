(() => {
// The hidden Twitch chat page used for Raid Now. The app asks it, every half second, to press
// Twitch's own Raid Now button; it answers with what it found. It never navigates or calls anything.
if (window.__nnfRaid || !location.pathname.startsWith('/popout/')) return
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
const RAID_NOW = /raid[-_ ]?now/i
const find = () => {
  const buttons = [...document.querySelectorAll('button')]
  // Twitch's own test names first: they stay the same in every language.
  return buttons.find((b) => RAID_NOW.test(b.getAttribute('data-a-target') || '') || RAID_NOW.test(b.getAttribute('data-test-selector') || ''))
    || buttons.find((b) => /^raid now$/i.test(norm(b.innerText)) || /^raid now$/i.test(norm(b.getAttribute('aria-label'))))
}
window.__nnfRaid = {
  /** 'loading', 'missing' (no button yet), 'waiting' (Twitch hasn't unlocked it yet) or 'clicked'. */
  press() {
    if (document.readyState === 'loading') return 'loading'
    const b = find()
    if (!b) return 'missing'
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') return 'waiting'
    b.click()
    return 'clicked'
  },
  /** For the log when the button is never found: the buttons that mention raids, so it can be fixed. */
  seen() {
    return [...document.querySelectorAll('button')]
      .filter((b) => /raid/i.test(b.outerHTML.slice(0, 600)) || !!b.closest('[class*="raid" i], [data-test-selector*="raid" i]'))
      .slice(0, 8)
      .map((b) => [b.getAttribute('data-a-target'), b.getAttribute('data-test-selector'), b.getAttribute('aria-label'), norm(b.innerText)].filter(Boolean).join(' | '))
      .join(' ; ') || 'no raid buttons on the page'
  }
}
})()
