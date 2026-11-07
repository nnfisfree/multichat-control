// Drives the built app in demo mode and checks core behaviour. Run after `npm run build`.
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { _electron as electron } from 'playwright-core'

const shots = resolve(process.argv[2] ?? 'out/e2e')
mkdirSync(shots, { recursive: true })
const rate = process.env.RATE ?? '600'

const app = await electron.launch(process.env.EXE
  ? { executablePath: process.env.EXE, args: ['--demo', `--demo-rate=${rate}`] }
  : { args: ['.', '--demo', `--demo-rate=${rate}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`) }
const shot = (n) => page.screenshot({ path: resolve(shots, `${n}.png`) })
const scrollState = () => page.$eval('.chat', (el) => ({ top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight }))

await page.waitForSelector('.row', { timeout: 15000 })
// Tests change settings, so start from known values and put the user's back at the end.
const saved = await page.evaluate(() => window.nnf.bootstrap().then((b) => b.settings))
await page.evaluate(() => window.nnf.saveSettings({ sendTargets: { twitch: true, youtube: true, kick: true }, windowOpacity: 1, showPronouns: true, emoteProviders: { bttv: true, seventv: true, ffz: true } }))
await page.reload()
await page.waitForSelector('.row', { timeout: 15000 })
await page.waitForTimeout(2500)
await shot('1-all')
check('live view pinned to bottom', (await scrollState()).gap < 40, JSON.stringify(await scrollState()))

// Platform tabs filter and retarget the composer.
await page.click('.tab:has-text("Kick")')
await page.waitForTimeout(400)
check('kick tab placeholder', (await page.getAttribute('.composer textarea', 'placeholder')).includes('Kick'))
check('no platform icon column on platform tab', (await page.$$('.row:not(.kind-event) .pf')).length === 0)
await page.click('.tab:has-text("All")')

// The placeholder names where the message will really go.
const placeholder = () => page.getAttribute('.composer textarea', 'placeholder')
await page.waitForTimeout(300)
check('placeholder says all when all are on', (await placeholder()).includes('all platforms'), await placeholder())
await page.click('.targets .pf-toggle.youtube')
await page.click('.targets .pf-toggle.kick')
await page.waitForTimeout(200)
check('placeholder names one platform', (await placeholder()) === 'Send a message to Twitch...', await placeholder())
await page.click('.targets .pf-toggle.kick')
await page.waitForTimeout(200)
check('placeholder names two platforms', (await placeholder()) === 'Send a message to Twitch and Kick...', await placeholder())
await page.click('.targets .pf-toggle.youtube')
await page.waitForTimeout(200)

// Pronouns appear beside Twitch chatters.
check('pronouns shown', (await page.$$('.pronoun')).length > 0)

// Sending reports each platform, and a partial failure keeps others working.
await page.fill('.composer textarea', 'failkick hello')
await page.keyboard.press('Enter')
await page.waitForSelector('.chip.bad')
check('partial failure visible', (await page.$$('.chip')).length === 3 && (await page.$$('.chip.bad')).length === 1)
await shot('2-partial-send')
check('composer cleared after partial success', (await page.inputValue('.composer textarea')) === '')

// Scrolling up pauses, the pill counts, and resuming pins again.
await page.waitForTimeout(1000)
await page.$eval('.chat', (el) => { el.scrollTop = el.scrollHeight / 2 })
await page.waitForSelector('.paused')
const top1 = (await scrollState()).top
await page.waitForTimeout(1500)
const top2 = (await scrollState()).top
await shot('3-paused')
check('paused holds position under traffic', Math.abs(top1 - top2) < 3, `${top1} -> ${top2}`)
check('pill counts new messages', /[1-9]\d* new message/.test(await page.textContent('.paused')), await page.textContent('.paused'))

// Events drawer keeps the paused scroll position, opens and closes.
await page.click('.tab.events')
await page.waitForTimeout(300)
await page.waitForTimeout(300)
await page.locator('.event-head').first().click()
await page.waitForTimeout(300)
await shot('4-events')
const bodies = await page.locator('.event-body').count()
check('event expands', bodies === 1, `bodies=${bodies}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('esc closes drawer', !(await page.$('.drawer.open')))
const top3 = (await scrollState()).top
check('scroll preserved across drawer', Math.abs(top2 - top3) < 3, `${top2} -> ${top3}`)
await page.click('.paused')
await page.waitForTimeout(500)
check('resume returns to live', (await scrollState()).gap < 40 && !(await page.$('.paused')), JSON.stringify(await scrollState()))

// Emote picker follows the tab, Twitch first on All.
await page.click('[aria-label="Emotes"]')
await page.waitForSelector('.emote-btn')
const groups = await page.$$eval('.picker h3', (h) => h.map((x) => x.textContent))
await shot('5-emotes')
check('picker prioritises Twitch on All', groups.filter((g) => g !== 'Frequently used')[0] === 'Channel' && groups.at(-1).includes('Emoji'), groups.join(' | '))
await page.click('.emote-btn >> nth=0')
check('picked emote lands in composer', (await page.inputValue('.composer textarea')).includes('nnf'), await page.inputValue('.composer textarea'))
await page.fill('.composer textarea', '')

// Action deck, confirmation and toggle.
await page.click('[aria-label="Actions"]')
await page.waitForSelector('.deck-btn')
await shot('6-actions')
await page.click('.deck-btn:has-text("Run ad")')
await page.waitForSelector('.sheet')
await page.click('.sheet button:has-text("Cancel")')
await page.click('.deck-btn:has-text("Slow mode")')
await page.waitForSelector('.deck-btn.active:has-text("Slow mode")')
check('toggle state updates', true)
await page.click('[aria-label="Close actions"]')

// Moderation menu deletes a message.
await page.click('.row:not(:has(.deleted)) .name >> nth=-1')
await page.waitForSelector('.ctx')
await shot('7-menu')
await page.click('.ctx button:has-text("Delete message")')
await page.waitForTimeout(400)
check('delete marks message', (await page.$$('.deleted')).length >= 1)

// Events and the Hype Train show in chat, and GIFs render as images.
await page.waitForTimeout(6000)
check('hype banner shown', !!(await page.$('.hype')), await page.$eval('.hype', (el) => el.innerText.replace(/\n/g, ' ')).catch(() => ''))
await page.waitForSelector('.ev', { timeout: 15000 }).then(() => check('event cards in chat', true), () => check('event cards in chat', false))
check('event cards carry badges', await page.$$eval('.ev', (cards) => cards.every((c) => c.querySelector('.ev-badge'))))
await shot('10-events-in-chat')
await page.waitForFunction(() => { const g = document.querySelector('.gif'); return g && g.naturalWidth > 0 }, null, { timeout: 8000 }).then(() => check('GIF renders as an image', true), () => check('GIF renders as an image', false))

// Settings.
await page.click('[aria-label="Settings"]')
await page.waitForSelector('.modal')
await page.waitForTimeout(200)
await shot('8-settings')
await page.click('[role="switch"][aria-label="Show pronouns"]')
await page.waitForTimeout(300)
check('pronouns can be hidden', (await page.$$('.pronoun')).length === 0)
await page.click('[role="switch"][aria-label="Show pronouns"]')
await page.click('[role="switch"][aria-label="BetterTTV"]')
await page.waitForTimeout(300)
await page.fill('[aria-label="Window opacity"]', '60')
await page.waitForTimeout(300)
check('opacity applies', Math.abs(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity()) - 0.6) < 0.02)
await page.fill('[aria-label="Window opacity"]', '0')
await page.waitForTimeout(300)
check('window never vanishes completely', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity())) >= 0.04)
await page.keyboard.press('Control+Shift+O')
await page.waitForTimeout(300)
check('shortcut restores opacity', Math.abs(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity()) - 1) < 0.02)
await page.selectOption('[aria-label="Chat font"]', 'Rajdhani')
await page.waitForTimeout(300)
check('chat font applies', (await page.$eval('.row', (el) => getComputedStyle(el).fontFamily)).includes('Rajdhani'))
await shot('8b-font')
const fontCount = await page.$$eval('[aria-label="Chat font"] option', (o) => o.length)
check('installed fonts listed', fontCount > 4, String(fontCount) + ' fonts')
await page.selectOption('[aria-label="Chat font"]', 'Segoe UI')
await page.$eval('.modal-scroll', (el) => { el.scrollTop = el.scrollHeight })
await page.waitForTimeout(200)
await shot('8c-settings-lower')
await page.click('[aria-label="Close settings"]')
await page.click('[aria-label="Emotes"]')
await page.waitForSelector('.emote-btn')
const noBttv = await page.$$eval('.picker h3', (h) => h.map((x) => x.textContent))
check('BetterTTV toggle removes its emotes', !noBttv.some((g) => g.includes('BTTV')), noBttv.join(' | '))
await page.click('[aria-label="Close emotes"]')

// Narrow window: nothing should overflow sideways.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(440, 700))
await page.waitForTimeout(500)
await shot('9-narrow')
check('no sideways overflow when narrow', await page.$eval('.shell', (el) => el.scrollWidth <= el.clientWidth + 1))

check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await page.evaluate((s) => window.nnf.saveSettings(s), saved)
await app.close()
const failed = results.filter((r) => !r).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
