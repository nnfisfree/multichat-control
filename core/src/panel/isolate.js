(() => {
// WebView2 runs this before the page's <html> exists, so it starts once the page is ready.
const main = () => {
  if (window.__nnfPanel || !location.pathname.startsWith('/popout/')) return
  // Messages to the app: a navigation to a private address, which the app intercepts and blocks.
  const tellApp = (kind, data) => { location.href = 'https://nnf-panel.invalid/' + kind + '#' + encodeURIComponent(JSON.stringify(data || {})) }
  // Styles go in as constructable stylesheets, which Twitch's content rules don't block.
  const sheets = { base: new CSSStyleSheet(), skin: new CSSStyleSheet() }
  const adopt = () => { document.adoptedStyleSheets = [...document.adoptedStyleSheets.filter((s) => s !== sheets.base && s !== sheets.skin), sheets.base, sheets.skin] }
  sheets.base.replaceSync(__NNF_CSS__)
  adopt()
  const root = document.documentElement
  const state = window.__nnfPanel = { loadedAt: Date.now(), autoUntil: Date.now() + 10000, lastInput: 0, lastClick: 0, signedIn: null, hadDialog: false, missingSince: 0, blankSince: 0, gaveUp: false, reloading: 0, wantReload: false, userAsked: false, reason: '', onScreen: false }
  const input = () => { state.lastInput = Date.now() }
  document.addEventListener('pointerdown', input, true)
  document.addEventListener('keydown', input, true)
  const balance = () => {
    const box = document.querySelector('.chat-input__buttons-container')
    if (!box) return null
    const buttons = [...box.querySelectorAll('button')]
    return buttons.find((b) => /points|bits/i.test(b.getAttribute('aria-label') || '') && b.getAttribute('data-a-target') !== 'bits-button')
      || buttons.find((b) => !b.getAttribute('data-a-target') && /\d/.test(b.innerText))
  }
  const openPopover = () => {
    const button = balance()
    if (!button || Date.now() - state.lastClick < 2000) return
    state.lastClick = Date.now()
    button.click()
  }
  state.open = () => { state.autoUntil = Date.now() + 8000 }
  const signIn = { label: 'Sign in to Twitch', run: () => { location.href = 'https://www.twitch.tv/login' } }
  // After giving up on an empty popover, Open loads the page fresh, which opens it cleanly.
  const reopen = { label: 'Open Rewards & Power-ups', run: () => {
    if (state.gaveUp) { state.gaveUp = false; refresh('you pressed Open', true); return }
    state.lastClick = 0; state.autoUntil = Date.now() + 5000; openPopover()
  } }
  const notice = (text, action) => {
    let box = document.getElementById('nnf-notice')
    if (!text) return box && box.remove()
    if (!box) {
      box = document.createElement('div')
      box.id = 'nnf-notice'
      root.appendChild(box)
    }
    if (box.dataset.text === text) return
    box.dataset.text = text
    box.replaceChildren()
    const p = document.createElement('div')
    p.textContent = text
    box.appendChild(p)
    if (action) {
      const b = document.createElement('button')
      b.textContent = action.label
      b.addEventListener('click', action.run)
      box.appendChild(b)
    }
  }
  const isolate = (dialog, content) => {
    if (!dialog.classList.contains('nnf-root')) {
      document.querySelectorAll('.nnf-root, .nnf-flat, .nnf-fill').forEach((e) => e.classList.remove('nnf-root', 'nnf-flat', 'nnf-fill'))
      dialog.classList.add('nnf-root')
      dialog.style.removeProperty('translate')
      state.dx = 0
      state.dy = 0
      for (let n = dialog.parentElement; n && n !== document.body; n = n.parentElement) n.classList.add('nnf-flat')
    }
    // Twitch rebuilds the popover's inside after opening, so the stretch is reapplied every time.
    // Only the chain down to the rewards content stretches, so no other layer can cover the tiles.
    for (let n = content; n && n !== dialog; n = n.parentElement) n.classList.add('nnf-fill')
    // The safety net: the popover must sit at the top-left corner of the panel. If Twitch's layout
    // still pushes it somewhere else (it was found below the visible area), shift it back.
    const r = dialog.getBoundingClientRect()
    if (Math.abs(r.x) > 0.5 || Math.abs(r.y) > 0.5) {
      state.dx = (state.dx || 0) - r.x
      state.dy = (state.dy || 0) - r.y
      dialog.style.setProperty('translate', state.dx + 'px ' + state.dy + 'px', 'important')
    }
  }
  // Asks the app to load the page again, and shows that it is happening.
  const refresh = (reason, user) => {
    state.reason = reason
    state.userAsked = !!user
    state.reloading = Date.now()
    state.wantReload = true
    tellApp('reload', { reason, user: !!user })
    state.blankSince = 0
    root.classList.remove('nnf-rewards')
    notice('Refreshing…')
  }
  // The app stops here when it has already refreshed twice in a short time: no more automatic
  // refreshes, just the Open button, so the panel can never loop.
  state.skin = (css) => { sheets.skin.replaceSync(css || ''); adopt() }
  state.pause = () => { state.gaveUp = true; state.reloading = 0; state.wantReload = false }
  const tick = () => {
    if (state.signedIn === false) {
      root.classList.remove('nnf-rewards')
      notice('Sign in to Twitch here once to see your custom Power-ups and your points. You stay signed in.', signIn)
      return
    }
    // Waiting for the app to reload the page. If that somehow doesn't happen, it gives up after
    // a few seconds and offers the Open button, so the panel can never stay blank and stuck.
    if (state.reloading) {
      if (Date.now() - state.reloading < 6000) return
      state.reloading = 0
      state.wantReload = false
      state.hadDialog = false
    }
    if (state.gaveUp) {
      root.classList.remove('nnf-rewards')
      notice('Rewards & Power-ups closed.', reopen)
      return
    }
    const content = document.querySelector('.reward-center__content')
    const dialog = content && content.closest('[role="dialog"]')
    if (dialog) {
      isolate(dialog, content)
      root.classList.add('nnf-rewards')
      notice(null)
      state.hadDialog = true
      state.missingSince = 0
      // Twitch can leave the popover open with nothing drawn in it. That is normal for a moment
      // while it loads; if it lasts, the page reloads, the same as after a redeem.
      // Only while the panel is on screen, as the app reports it.
      if (!state.onScreen) { state.blankSince = 0; return }
      const r = content.getBoundingClientRect()
      const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
      const empty = r.width < 40 || r.height < 40 || !content.innerText.trim() || !hit || hit === document.body || hit === root
      if (!empty) { state.blankSince = 0; return }
      state.blankSince = state.blankSince || Date.now()
      // Twitch's points popover can take several seconds to load, showing little more than a
      // spinner, so only a popover still empty after 20 seconds counts as stuck.
      if (Date.now() - state.blankSince < 20000) return
      state.blankSince = 0
      // A refresh that didn't help within 30 seconds isn't repeated: the Open button is offered
      // instead, so the panel can never loop. The time survives the reload in sessionStorage.
      let last = 0
      try { last = Number(sessionStorage.getItem('nnfBlankRefresh')) || 0 } catch {}
      if (Date.now() - last < 30000) {
        state.gaveUp = true
        root.classList.remove('nnf-rewards')
        notice('Rewards & Power-ups closed.', reopen)
        return
      }
      try { sessionStorage.setItem('nnfBlankRefresh', String(Date.now())) } catch {}
      refresh('the popover was open but empty')
      return
    }
    // Twitch closes the popover after a redeem, and reopening it can leave it blank, so the page
    // reloads and opens straight back on the main menu, ready for the next one.
    if (state.hadDialog) {
      state.missingSince = state.missingSince || Date.now()
      if (Date.now() - state.missingSince < 800) return
      // Right after your own click (a redeem) it doesn't count toward the limit; with no click it does.
      const byYou = Date.now() - state.lastInput < 10000
      refresh(byYou ? 'Twitch closed the popover after your redeem' : 'Twitch closed the popover by itself', byYou)
      return
    }
    const button = balance()
    if (!button) {
      // Signed out, or Twitch is still loading: after a moment, show the page so sign-in is possible.
      const consent = document.querySelector('[data-a-target="consent-banner-accept"]')
      if (consent || Date.now() - state.loadedAt > 6000) { root.classList.remove('nnf-rewards'); notice(null) }
      else notice('Loading Twitch…')
      return
    }
    root.classList.remove('nnf-rewards')
    const userBusy = Date.now() - state.lastInput < 1500
    if (Date.now() < state.autoUntil && !userBusy) {
      notice('Opening Rewards & Power-ups…')
      openPopover()
    } else notice('Rewards & Power-ups closed.', reopen)
  }
  let queued = false
  const soon = () => {
    if (queued) return
    queued = true
    // Once per frame at most, but always before the frame is drawn.
    requestAnimationFrame(() => { queued = false; tick() })
  }
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true })
  setInterval(tick, 400)
  tick()
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true })
else main()
})()
