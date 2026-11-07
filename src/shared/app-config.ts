export const APP_NAME = "NoNameFound's Multichat Stream"

/**
 * Public Twitch Client ID built into release builds. Twitch public clients have no secret,
 * so this value is safe to commit. Leave empty to have users paste their own in the setup screen.
 */
export const TWITCH_CLIENT_ID = 't1w7icde2uifot9blqbux4f5y9lgig'

/** Kick needs an exact redirect match, so this port is fixed. Register this URL in the Kick app. */
export const KICK_REDIRECT_PORT = 53682
export const KICK_REDIRECT_URI = `http://localhost:${KICK_REDIRECT_PORT}/callback`
