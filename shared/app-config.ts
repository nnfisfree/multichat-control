export const APP_NAME = 'Multichat Control'

/**
 * Streamlabs and StreamElements logins stay off until both services approve the app (Streamlabs
 * allows only 10 test users before that; StreamElements hasn't issued its keys yet). Set to true
 * once both have approved: the Settings choice, the Connections menu and the engine all follow it.
 */
export const ALERTS_READY = false

/**
 * Kick needs an exact redirect match, so this port is fixed. Register this URL in the Kick app.
 * Shown in Settings; the login itself runs in the Rust core (core/src/auth.rs).
 *
 * Building your own copy? The other values live in the core:
 *   - the Twitch Client ID: TWITCH_CLIENT_ID in core/src/auth.rs
 *   - where updates come from: UPDATE_REPO in core/src/updater.rs
 */
export const KICK_REDIRECT_PORT = 53682
export const KICK_REDIRECT_URI = `http://localhost:${KICK_REDIRECT_PORT}/callback`
