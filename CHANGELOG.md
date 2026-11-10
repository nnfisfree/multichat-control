# Changelog

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
