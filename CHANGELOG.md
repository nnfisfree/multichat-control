# Changelog

## 0.2.5

**New**

- **Streamer.bot.** Run any Streamer.bot action from the message box with `/sb Action name`; text after the name reaches the action as `rawInput`, `input0`, `input1`… The list of actions and chat commands follows Streamer.bot live: adding, renaming, turning off or deleting one there updates it here. Works with or without Streamer.bot's WebSocket password, which is stored encrypted on the PC. Set it up in Settings → Connections → Streamer.bot.
- **The / list** moved to the left of the message box, is split into Twitch, Multichat Control and Streamer.bot groups with their icons, and has a search box.
- **Channel stats** under the message box: followers and subscribers for Twitch and Kick, subscribers for YouTube, styled like the clock. Settings → App → Clock & Stats.
- **Myst Bourne**, a purple and white skin.
- **Popups close when you click outside them.**
- **What's new**: shown once after each update, with a Show me button for each feature.

**Changed**

- The app is now called just **Multichat Control** in its title bar, window and tray.
- **Streamlabs and StreamElements are paused** (marked Soon.. in Settings) until both approve the app.

## 0.2.3

**New**

- **Raid bar.** Start a raid with `/raid channel` or the Start raid action and a bar appears at the top of chat, like the one in OBS's Twitch chat: the channel's profile picture with a LIVE tag, the game they're playing, their viewers and stream title, and Twitch's 90-second countdown with a progress bar. It sits above the pinned message, which stays visible under it, and takes its colours from your skin.
- **Raid Now.** Send the raid without waiting for the countdown. It unlocks 10 seconds in, exactly like on Twitch. Twitch's API can't do this, so the app presses Twitch's own button on your chat page, kept open out of sight while the raid counts down. It needs the Twitch sign-in from Rewards & Power-ups. Also as `/raidnow`.
- **Cancel** is red in every skin, and the bar goes away by itself once Twitch sends the raid.

## 0.2.2

**New**

- **Messages that tag you are highlighted.** When a viewer writes `@yourname`, the message gets a band in the colour of its platform: purple for Twitch, red for YouTube, green for Kick. It uses the names of the accounts you're logged in with (Twitch login and display name, YouTube @handle and channel name, Kick username), ignores letter case, and never lights up for your own messages or for look-alikes like `@yourname_bot` or an email address.
- **A homepage and privacy policy** at [multichat.nonamefound.lol](https://multichat.nonamefound.lol/), explaining exactly what the app does with your YouTube data.

**Fixed**

- **YouTube login works for everyone.** Google only let approved test accounts log in, and showed everyone else "Access blocked". The app's Google project is now public, so any account can log in; Google shows an "unverified app" notice first (click Advanced, then Go to MultichatControl). Logins also no longer expire every 7 days. Thanks to **Zayso** for reporting it.
- **The X button works again when set to Minimize to tray.** After some window moves, such as resizing from the top edge, the window could stop hiding while every click on X still arrived. The app now checks that the window really hid (or showed), and corrects it when it didn't.
- If you click "Back to safety" on Google's notice, the app now explains how to continue instead of only saying the login was declined.

## 0.2.1

**New**

- **A clock** under the message box, on the right: your PC's time as hh:mm:ss AM/PM. Point at it to see the date. Its colours follow the skin. Turn it off in Settings → App → Clock.
- **OBS Studio's logo** in Connections and Settings
- **Donations** from Streamlabs and StreamElements show a gold coin with a dollar sign

**Fixed**

- The window's X button could stop responding after changing the skin or resizing. Closing now always finishes, and the app closes on its own within a few seconds if something holds it up.
- Opening Appearance no longer asks for permission to use the fonts on your computer
- Window opacity works again: since 0.2.0 the window turned solid as soon as it was maximized, restored or resized

## 0.2.0

**Rebuilt to be light.** The app moved from Electron to Tauri 2: it uses Microsoft Edge WebView2, which is part of Windows 10 and 11, instead of shipping its own Chromium.

- One 8 MB exe instead of a 150 MB zip, with nothing beside it but `user-data`
- Less memory while running
- Updating from 0.1 keeps your settings, logins, saved events and chat history, and removes the old version's files. The rewards panel asks you to sign in to Twitch once more.
- If WebView2 is ever missing, the app says so and offers Microsoft's installer

**New**

- **Every Twitch chat command** in the message box, suggested as you type: raids, pins, announcements, shoutouts, timeouts and bans, warnings, chat modes, shield mode, mods and VIPs, ads, markers, title and category, polls, predictions, colour, whispers and blocks
- **Pinned messages** at the top of chat, with Unpin; hidden while a Hype Train shows. Right-click a Twitch message to pin it.
- **8 skins**: POS Club, Dracula, Catppuccin Mocha, Tokyo Night, Nord, Gruvbox Dark, Rosé Pine and OLED Black. The window buttons, text and Twitch's rewards panel follow the skin; the window edge keeps its glow.
- **Settings in categories**: Connections, Appearance, Chat, App and About
- A fuller connection bar, with the progress written inside it
- "Close or keep in the tray?" is now asked inside the app

**Fixed**

- The rewards panel no longer goes blank or reloads in a loop
- Connection dots: green when connected or waiting for a stream, yellow only while connecting
- The OBS uptime no longer skips seconds
- Shoutouts that other channels give you no longer appear in Events
- The commands list opens above the message box and closes when you pick one

**Under the hood**

- Logins never reach the app's window: the Rust side keeps them and adds them to each request
- New project layout: `ui/`, `engine/`, `core/`, `shared/`, `assets/`, `proto/`, `docs/`, `scripts/`
