// Renders resources/icon.png. Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a1590"/><stop offset=".6" stop-color="#1c0c5a"/><stop offset="1" stop-color="#14508f"/></linearGradient>
<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d946ef"/><stop offset=".5" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
<linearGradient id="n" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5d0fe"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
</defs>
<path d="M92 24H420L488 92V420L420 488H92L24 420V92Z" fill="url(#bg)" stroke="url(#edge)" stroke-width="16"/>
<path d="M136 372V140H188L324 288V140H376V372H324L188 224V372Z" fill="url(#n)"/>
</svg>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, useContentSize: true, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><style>html,body{margin:0;width:512px;height:512px;overflow:hidden;background:transparent}svg{display:block}</style><body>${svg}</body>`))
  await new Promise((r) => setTimeout(r, 500))
  const image = await win.webContents.capturePage()
  const dir = join(__dirname, '../resources')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'icon.png'), image.toPNG())
  app.quit()
})
