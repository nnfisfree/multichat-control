import { fetchJson, HttpError, sleep } from '../net'

export interface TwitchTokens { access: string; refresh: string; expiresAt: number }

const TWITCH_SCOPES = [
  'user:read:chat', 'user:write:chat', 'user:read:emotes',
  'moderator:manage:announcements', 'moderator:manage:shoutouts', 'moderator:manage:chat_settings',
  'moderator:manage:banned_users', 'moderator:manage:chat_messages', 'moderator:manage:shield_mode',
  'moderator:read:followers', 'channel:moderate',
  'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:predictions', 'channel:manage:raids',
  'channel:manage:broadcast', 'channel:edit:commercial', 'channel:read:subscriptions', 'channel:read:hype_train',
  'channel:read:goals', 'channel:read:ads', 'bits:read', 'clips:edit',
  'moderator:read:chatters', 'moderation:read', 'channel:read:vips'
]

const form = (data: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString()
})

const toTokens = (t: any): TwitchTokens => ({ access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 })

/** Runs Twitch's device flow. Public clients have no secret, so nothing sensitive ships in the app. */
export async function deviceLogin(
  clientId: string,
  show: (code: string, url: string) => void,
  cancelled: () => boolean
): Promise<TwitchTokens> {
  const scopes = TWITCH_SCOPES.join(' ')
  const d = await fetchJson('https://id.twitch.tv/oauth2/device', form({ client_id: clientId, scopes }))
  show(d.user_code, d.verification_uri)
  const deadline = Date.now() + d.expires_in * 1000
  while (Date.now() < deadline) {
    await sleep(d.interval * 1000)
    if (cancelled()) throw new Error('Login cancelled.')
    try {
      return toTokens(await fetchJson('https://id.twitch.tv/oauth2/token', form({
        client_id: clientId, scopes, device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })))
    } catch (err) {
      if (err instanceof HttpError && /authorization_pending/.test(err.message)) continue
      throw err
    }
  }
  throw new Error('The login code expired. Please try again.')
}

export async function refreshTokens(clientId: string, refresh: string): Promise<TwitchTokens> {
  return toTokens(await fetchJson('https://id.twitch.tv/oauth2/token', form({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refresh })))
}

export async function validate(access: string): Promise<{ login: string; user_id: string; scopes: string[]; expires_in: number }> {
  return fetchJson('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${access}` } })
}
