export const APP_NAME = "NoName's Multichat Control"

/** The public GitHub repository that updates come from. */
export const UPDATE_REPO = 'nnfisfree/multistream-control'

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
/** StreamElements and Streamlabs need an exact redirect address too: http://localhost:53683/<service>. */
export const ALERTS_REDIRECT_PORT = 53683
