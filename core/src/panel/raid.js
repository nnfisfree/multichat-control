(() => {
// Runs on the hidden Twitch chat page used for Raid Now. Rust asks it every half second to click
// Twitch's Raid Now button and it reports what it found. It never navigates or calls anything.
if (window.__nnfRaid || !location.pathname.startsWith('/popout/')) return
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
const RAID_NOW = /raid[-_ ]?now/i
const find = () => {
  const buttons = [...document.querySelectorAll('button')]
  // check Twitch's data-a-target / test attributes first, those are the same in every language
  return buttons.find((b) => RAID_NOW.test(b.getAttribute('data-a-target') || '') || RAID_NOW.test(b.getAttribute('data-test-selector') || ''))
    || buttons.find((b) => /^raid now$/i.test(norm(b.innerText)) || /^raid now$/i.test(norm(b.getAttribute('aria-label'))))
}
window.__nnfRaid = {
  /** 'loading', 'missing' (no button yet), 'waiting' (Twitch hasn't unlocked it yet) or 'clicked' */
  press() {
    if (document.readyState === 'loading') return 'loading'
    const b = find()
    if (!b) return 'missing'
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') return 'waiting'
    b.click()
    return 'clicked'
  },
  /** Raid-ish buttons we did find, logged when Raid Now never shows up, so the selector can be fixed. */
  seen() {
    return [...document.querySelectorAll('button')]
      .filter((b) => /raid/i.test(b.outerHTML.slice(0, 600)) || !!b.closest('[class*="raid" i], [data-test-selector*="raid" i]'))
      .slice(0, 8)
      .map((b) => [b.getAttribute('data-a-target'), b.getAttribute('data-test-selector'), b.getAttribute('aria-label'), norm(b.innerText)].filter(Boolean).join(' | '))
      .join(' ; ') || 'no raid buttons on the page'
  }
}
})()
