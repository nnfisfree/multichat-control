# Changelog

## 0.3.1

**New**

- **Event pop-ups.** New subs, gifts, cheers, raids, follows, redemptions and donations rise out of the message box with the same look as their chat card, stay for the time you pick (2 to 30 seconds, 6 by default), then slide back down. Hover one to keep it open, click it to close it. They follow the Events drop-down's platform and type filters. Settings → Chat → Event Pop-ups.
- **Supporter messages always show.** The message that comes with a resub, cheer, Super Chat or tip is shown in chat, in the pop-up and in the Events drop-down, without opening the event.
- **Buy Me a Coffee.** Tips, memberships and shop sales (Extras) from your Buy Me a Coffee page show up live in chat and in Recent events, with Buy Me a Coffee's logo. Connect it in Settings → Connections: click **Connect**, create a read-only token on the page that opens, and paste it. It works on its own, next to Streamlabs or StreamElements.
- **Every month counts.** When a member renews, the card says how many months they've supported you in total, even across memberships they cancelled and started again ("renewed their membership (10 months)"). Tips and renewals made while the app was closed are added to Recent events quietly, without filling chat. Private messages stay private.
- **Test alerts while offline.** Test triggers fired in Streamer.bot (follow, cheer, sub, gift, raid and redemption on Twitch, plus Kick and YouTube) and test alerts from StreamElements or Streamlabs show up with a **TEST** tag. They're never saved, so a restart clears them, and **Clear → Clear tests** removes them right away.

**Changed**

- **No more clip events.** New clips no longer show up in chat, in pop-ups or in Events, and the app no longer checks Twitch and Kick for them. Clip links people post in chat still get their preview card.
- **What's new** lists only what changed in the version you just got.

**Fixed**

- Things you did on your own channel, like gifting a sub, were tagged TEST. Only real test alerts get the tag now.

## 0.3.0

**New**

- **Wobbly window.** The window bends like jelly while you drag it by the title bar and settles when you let go, inspired by KDE Plasma's Wobbly Windows on Linux. It can be clicked, scrolled and typed in while it settles. Off by default; Settings → Appearance → Window, with an Intensity slider.
- **The window remembers where it was**: size, position, monitor and maximized state. If that monitor isn't connected, it opens on the main monitor.
- **Gift bombs, sub by sub.** The summary card ("gifted 5 subs to the community") is followed by one line per sub showing who received it.
- **Custom Power-ups show their name** instead of "a custom Power-up".
- **Animated badge icons** on events: a train for Hype Trains, a present for gifts, a die for channel points, a Bits gem for cheers, a flame for Power-ups and a heart for follows. They stay still when Windows is set to reduce motion.
- **Badges on the user card**: VIP, moderator, artist, subscriber and the event badge a viewer wears in chat, with their pictures.
- **Two new skins: Kanagawa and Sweet**, two favourites from the Linux community.
- **OBS tip.** A one-time note on how to connect OBS, for new installs and anyone who never set OBS up.

**Changed**

- **Twitch purple** for Twitch gifts, Power-ups and Hype Trains, and their badges.
- **Channel stats moved to the title bar**, and OBS stats moved under the message box, next to the clock. The clock and OBS stats now look just like the title-bar stats in every skin, and OBS's logo always leads the OBS stats.
- **OBS stats are on by default** for new installs. Streamer.bot stays off until you turn it on.
- **Nord and Gruvbox were removed.** Anyone using them goes back to POS Club.
- A thinner window edge, and capsules of one size without outlines.

## 0.2.7

**Fixed**

- The "Log in to Twitch again" notice stayed in chat after logging in again. It now fades out as soon as the new login has the permissions it asked for.

## 0.2.6

**New**

- **Held messages (Twitch AutoMod).** When AutoMod holds a message, it shows in chat with an amber highlight, the reason (AutoMod category and level, a blocked term, or a blocked link) and **Allow** / **Deny** buttons. Once anyone decides, here or on Twitch, the row says "Allowed by …", "Denied by …" or "Expired". Needs a fresh Twitch login (the app asks for it).
- **Suspicious users (Twitch).** Messages from users Twitch marks as suspicious or restricted get a red highlight with Twitch's reasons (likely ban evader, banned in channels that share ban info with you) and **Delete** / **Ban** buttons.
- **Spam warnings on every platform.** Messages that offer to sell followers or viewers and point to a site (also disguised as `site . com`) or ask to be messaged are marked "Looks like spam" on Twitch, Kick and YouTube, with **Delete** / **Ban**. The streamer, moderators and VIPs are never marked, and nothing is deleted on its own. Settings → Chat → Spam Warnings.
- **Video and clip previews.** YouTube videos, Shorts and lives, and Twitch, Kick and YouTube clips get a card under the message: picture, length, title, channel, who clipped it and views. Click to open. Settings → Chat → Link Previews.
- **New clips in chat.** When anyone clips your stream on Twitch or Kick, a card with the clip appears in chat and in Events. Settings → Chat → Events in Chat → New Clips.
- **The version** shows next to the app name in the title bar.

**Changed**

- **Follows** now show in chat by default on new installs. A choice you already made is kept.

**Fixed**

- The first messages and events after start-up could appear twice.

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
