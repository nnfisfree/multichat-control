export const APP_NAME = "NoName's Multichat Control"

/**
 * Public Twitch Client ID built into release builds. The app must be registered as Public:
 * a Confidential app logs in fine but can never renew, so it drops after about 4 hours.
 * Twitch public clients have no secret,
 * so this value is safe to commit. Leave empty to have users paste their own in the setup screen.
 */
export const TWITCH_CLIENT_ID = '4m3nuqjxsh7i77pmmhicljsoomghwd'

/** Kick needs an exact redirect match, so this port is fixed. Register this URL in the Kick app. */
export const KICK_REDIRECT_PORT = 53682
export const KICK_REDIRECT_URI = `http://localhost:${KICK_REDIRECT_PORT}/callback`
