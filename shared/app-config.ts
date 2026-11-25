export const APP_NAME = 'Multichat Control'

/**
 * StreamElements and Streamlabs. They never approved an app login, so the streamer logs in to their
 * own account on the service's website inside the app (core/src/sitelogin.rs) instead. Turning this
 * off hides both again: the Settings option, the Connections menu and the engine all key off it.
 */
export const ALERTS_READY = true

/**
 * Kick wants an exact redirect URI match, so the port is fixed. Register this URL in the Kick app.
 * Shown in Settings; the actual login happens in Rust (core/src/auth.rs).
 *
 * Building your own copy? The other values are on the Rust side:
 *   - Twitch Client ID: TWITCH_CLIENT_ID in core/src/auth.rs
 *   - where updates come from: UPDATE_REPO in core/src/updater.rs
 */
export const KICK_REDIRECT_PORT = 53682
export const KICK_REDIRECT_URI = `http://localhost:${KICK_REDIRECT_PORT}/callback`
