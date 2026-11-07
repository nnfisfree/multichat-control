import { shell } from 'electron'
import { APP_NAME } from '../../shared/app-config'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const b64 = (b: Buffer): string => b.toString('base64url')

const PAGE = (ok: boolean): string => `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<body style="background:#150a3c;color:#fff;font:18px sans-serif;display:grid;place-items:center;height:90vh">
<div>${ok ? 'Login complete. You can close this tab.' : 'Login failed. Please return to the app and try again.'}</div>`

export interface LoopbackOptions {
  authorizeUrl: string
  params: Record<string, string>
  /** 0 picks a free port. Kick needs a fixed one. */
  port: number
  host: '127.0.0.1' | 'localhost'
  path: string
  timeoutMs?: number
}

/**
 * Opens the system browser and waits for the redirect on a local port. PKCE and the state value
 * mean a stray request to the port can't complete or hijack the login.
 */
export async function loopbackLogin(o: LoopbackOptions): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const verifier = b64(randomBytes(48))
  const challenge = b64(createHash('sha256').update(verifier).digest())
  const state = b64(randomBytes(24))

  return new Promise((resolve, reject) => {
    let redirectUri = ''
    const finish = (fn: () => void): void => {
      clearTimeout(timer)
      server.close()
      server.closeAllConnections()
      fn()
    }
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${o.host}`)
      if (url.pathname !== o.path) {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const ok = !!code && url.searchParams.get('state') === state
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }).end(PAGE(ok))
      if (ok) finish(() => resolve({ code: code!, verifier, redirectUri }))
      else if (url.searchParams.get('error')) finish(() => reject(new Error(url.searchParams.get('error_description') || url.searchParams.get('error')!)))
    })
    const timer = setTimeout(() => finish(() => reject(new Error('Login timed out.'))), o.timeoutMs ?? 300000)
    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(err.code === 'EADDRINUSE' ? `Login port ${o.port} is in use by another program.` : err.message))
    })
    server.listen(o.port, o.host === 'localhost' ? '127.0.0.1' : o.host, () => {
      const port = (server.address() as AddressInfo).port
      redirectUri = `http://${o.host}:${port}${o.path}`
      const url = new URL(o.authorizeUrl)
      const all = { ...o.params, redirect_uri: redirectUri, response_type: 'code', state, code_challenge: challenge, code_challenge_method: 'S256' }
      for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v)
      void shell.openExternal(url.href)
    })
  })
}
