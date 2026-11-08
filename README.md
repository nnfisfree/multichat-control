<div align="center">

<img src="docs/media/banner.jpg" width="100%" alt="NoName's Multichat Control: one window, every stream chat. Free and open source, for Twitch, YouTube and Kick." />

<br />

[![Download](https://img.shields.io/github/v/release/nnfisfree/multistream-control?label=Download&style=for-the-badge&color=34e39f)](https://github.com/nnfisfree/multistream-control/releases/latest)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-5b35f0?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-27a9e8?style=for-the-badge)

**Read and write Twitch, YouTube and Kick chat together, see every event as it happens, and run channel actions in one click.**
<br />
A single portable app with nothing else to install. It updates itself.

<br />

<img src="docs/media/demo.gif" width="760" alt="Animated tour of NoName's Multichat Control showing live chat, the events drop-down, the emote picker, sending a message and quick actions" />

<sub>Every image here is built-in demo mode, with invented chatters and placeholder emotes.</sub>

</div>

---

## Why it exists

Streaming to several platforms usually means juggling browser tabs, or running a large bot suite just to read chat. NoName's Multichat Control is focused on the moment you're live: one merged chat, one list of events, and real controls within a click.

It doesn't need OBS, a bot, a server or a runtime. Each person logs in with their own accounts, so it works for any streamer.

> [!NOTE]
> This is an early release, and live use on all three platforms is still being tested. Please [report](../../issues) anything that doesn't work.

## Features

<table>
<tr>
<td width="50%" valign="top">

### 💬 Unified chat
- **All, Twitch, YouTube and Kick** tabs
- On All, choose exactly where a message goes
- **Chat from your last 5 streams**, so you can read what you missed
- Pauses when you scroll, with a new-message count
- Reply, delete, time out, ban or shout out from any message

</td>
<td width="50%" valign="top">

### ⚡ Events and history
- Subs, gifts, raids and redemptions as coloured cards in chat
- **Recent events from every platform, in time order**, kept between sessions
- Filter by platform and type, sort newest or oldest first
- Your own test redeems are tagged, and cleared in one click
- Gift bombs become one big card, not fifty rows
- Hype Train banner with level, progress and countdown

</td>
</tr>
<tr>
<td valign="top">

### 💸 Alerts and donations
- **One-click login with Streamlabs** (StreamElements coming soon)
- Donations and tips arrive live, with past donations at start
- Fills in the past subs, gifts and Bits that platforms don't share
- The same event from two sources is shown only once

</td>
<td valign="top">

### 🎛️ One-click control
- Twitch's real Rewards & Power-ups panel, custom Power-ups included
- Back on the main menu after every redeem
- Announcements, shoutouts, raids, ads and clips
- Slow, follower-only, sub-only and emote-only modes
- Shield mode, polls, predictions, stream title and category

</td>
</tr>
<tr>
<td valign="top">

### 😀 Emotes and media
- Picker that follows the active tab, with search
- Twitch, BetterTTV, 7TV, FrankerFaceZ and Kick emotes
- Overlay emotes like 7TV's RainTime sit on top, as in other chat apps
- Animated cheermotes and Twitch chat GIFs
- Pronouns beside Twitch chatters

</td>
<td valign="top">

### 🔄 Always connected, always up to date
- A progress bar while platforms connect, and a status menu for every connection
- Reconnect or log in from that menu, without opening Settings
- Installs new versions in one click, checked against GitHub's checksum
- Your settings and logins are never touched by an update

</td>
</tr>
</table>

## Screenshots

<table>
<tr>
<td align="center"><img src="docs/media/chat.png" alt="Merged chat from Twitch, YouTube and Kick with event cards and a Hype Train banner" /><br /><b>Every chat in one place, with live events</b></td>
<td align="center"><img src="docs/media/events.png" alt="Events drop-down with platform filters, type filter, sort and Clear buttons, and a redeem tagged TEST" /><br /><b>Recent events, filtered, sorted and tidy</b></td>
</tr>
<tr>
<td align="center"><img src="docs/media/history.png" alt="Chat from a past stream under a divider, with a button to show the stream before and the Commands list open" /><br /><b>Read what you missed in your last streams</b></td>
<td align="center"><img src="docs/media/connections.png" alt="Connections menu listing Twitch, YouTube and Kick with their state, Reconnect and Log out" /><br /><b>Every connection at a glance</b></td>
</tr>
<tr>
<td align="center"><img src="docs/media/emotes.png" alt="Emote picker grouped by provider, with search" /><br /><b>Emote picker for every provider</b></td>
<td align="center"><img src="docs/media/actions.png" alt="Quick actions panel with the Twitch Rewards button and channel actions" /><br /><b>Quick actions and Twitch rewards</b></td>
</tr>
<tr>
<td align="center"><img src="docs/media/settings.png" alt="Settings with one-row logins for each platform and the Alerts and Donations picker" /><br /><b>One-click logins, one row per platform</b></td>
<td align="center"><img src="docs/media/support.png" alt="About page with the Support chapter and Donate, Subscribe and Gadgets Store buttons" /><br /><b>The story behind it, inside the app</b></td>
</tr>
</table>

## Get started

### Download

1. Get the latest version from **[Releases](https://github.com/nnfisfree/multistream-control/releases/latest)**: the **`.zip`** (unzip anywhere and run `Multichat-Control.exe`) or the single **portable `.exe`**.
2. Windows SmartScreen may warn on first run because the exe isn't code-signed. Choose **More info**, then **Run anyway**.

That's it. Future versions arrive through the app's own update banner.

### Connect your accounts

Open the gear icon and click **Log in** beside each platform you stream on. You sign in on the platform's own page: Twitch, your Google account for YouTube, or your Kick account. There's nothing else to set up.

- **Twitch** expires its logins after about 30 days, so the app may ask you to log in again.
- **Rewards panel:** click the gem icon, then **Sign in to Twitch** inside the panel once. This is a separate sign-in to Twitch's website, and it stays signed in. Your custom Power-ups and points only show once you're signed in.
- **Alerts & Donations:** pick the one service you use and click **Log in**.
- **The status menu** next to the gear shows every connection. Click a row to reconnect or log in.

### Commands

Type these in the message box. They run in the app and are never sent to your chat. The **/** button next to Quick actions lists them.

| Command | What it does |
|---|---|
| `/clearhistory` | Clears the chat in the app and deletes the saved chat of past streams. Your viewers' chat isn't affected. |

### Try it without an account

```bash
npm run demo
```

Demo mode simulates all three platforms, so you can explore everything except the real Twitch panel.

<details>
<summary><b>Build it from source</b></summary>

```bash
git clone https://github.com/nnfisfree/multistream-control.git
cd multistream-control
npm install
npm run dist
```

You'll find the zip and the portable exe in `release/`. Building needs [Node.js](https://nodejs.org); running the app doesn't.

Twitch works as it is. YouTube, Kick, Streamlabs and StreamElements need a developer app, because their credentials aren't stored in this repository. For YouTube and Kick you can enter your own in Settings, under **Advanced**, or include them all in your build.

**YouTube**

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create a project and enable **YouTube Data API v3**.
2. Configure the OAuth consent screen, then **publish** it. Logins from an app left in Testing expire after 7 days.
3. Create an OAuth client ID of type **Desktop app**.

Google warns that an app is unverified until it passes Google's review.

**Kick**

1. At [kick.com/settings/developer](https://kick.com/settings/developer), enable developer mode and create an app.
2. Set the redirect URL to exactly `http://localhost:53682/callback`.
3. Enable all scopes.

**Streamlabs**

1. [Register an app](https://streamlabs.com/dashboard#/oauth-clients/register) with the redirect URL `http://localhost:53683/streamlabs` and the scopes `donations.read` and `socket.token`.
2. Until Streamlabs approves it, only the accounts you whitelist (up to 10) can log in.

**StreamElements**

StreamElements gives out app credentials on request. Use the redirect URL `http://localhost:53683/streamelements` and the scopes `channel:read activities:read tips:read`.

**Including them in your build**

Copy `.env.example` to `.env.local`, fill it in, and run `npm run dist`. People using that build can then log in without any setup.

Never commit `.env.local`. Anything built into an exe can be extracted from it, so only do this with apps made for this purpose, and don't reuse their credentials elsewhere.

**Publishing your own builds?** Also register your own Twitch app as a **Public** client. A Confidential app can log in, but its logins drop after about 4 hours. Set its Client ID in `src/shared/app-config.ts`. A public Client ID isn't a secret. Then set `UPDATE_REPO` in the same file to your repository, so your users get your updates.

</details>

## Good to know

These limits come from the platforms.

| Platform | Limit |
|---|---|
| **Twitch** | No public API can redeem a reward or Power-up, so the panel is Twitch's own page. **Power-ups there spend real Bits.** |
| **Twitch** | Only the app that created a reward can edit it or fulfil its redemptions. Rewards from the Twitch dashboard are read-only here, and their redemptions still appear in Events. |
| **Twitch** | The API keeps dated history only for follows, past streams, polls, predictions and the Hype Train record. Subs, gifts, Bits and raids from before the app started come from Streamlabs or StreamElements, or build up as the app sees them. |
| **Twitch** | The rewards panel depends on Twitch's page layout, so a Twitch redesign can stop it opening until the app is updated. Rewards that need a typed chat message must be redeemed in Twitch's normal chat. |
| **Twitch** | Pronouns come from the community service [pronouns.alejo.io](https://pronouns.alejo.io), so they cover Twitch chatters who registered there. Turning them on sends chatter names to that service. |
| **YouTube** | Until Google verifies this app, YouTube login on official builds only works for approved testers, and those logins expire every 7 days. |
| **YouTube** | Chat exists only during a live broadcast. The app waits and connects by itself. |
| **YouTube** | Each Google project gets 10,000 quota units a day, shared by everyone using that build. Each message sent costs 20. To avoid sharing, enter your own app in Settings. Messages are limited to 200 characters. |
| **YouTube** | Custom member emoji have no documented API, so they show as text and aren't in the picker. |
| **Kick** | Official events need a public web server, so **reading uses the same unofficial live connection as Kick's website**. Kick can change it without notice. Sending and moderation use the official API, and the app warns you if reading stops. |
| **Streamlabs** | Keeps a history of donations only. Its other alerts arrive live. |

## Privacy and security

- **Your data stays with you.** Settings, logins, saved events and chat history live in a `user-data` folder beside the exe, and the app has no server of its own. **Keep that folder private, because it holds your logins.**
- **Logins are encrypted** for your Windows user, so moving to another PC means logging in again.
- **Chat history stays on your PC.** The last 5 streams are kept in `user-data`, with deleted messages saved only as deleted. Turn it off under Settings → Chat, or type `/clearhistory` to delete it.
- **Coming from version 0.1.2 or earlier?** The data folder used to be called `nnf-data`. The app renames it to `user-data` on first start, so your logins and settings carry over.
- **Updates are verified.** The app only installs a download that matches GitHub's checksum, and never touches `user-data`.
- **Twitch's panel is isolated.** It runs in its own session and never sees the app's tokens.
- **Chat can't run code.** Messages are displayed as plain text, and links open only in your browser.
- **Third parties:** the app contacts the platforms and alert service you connect, GitHub to check for updates, plus BetterTTV, 7TV, FrankerFaceZ and pronouns.alejo.io for the features you leave on. Each can be turned off in Settings.

## Support the project

NoName's Multichat Control is free and open source, and it always will be. It's built in my spare time, so if it makes your streams easier, you can help keep it going:

<div align="center">

[![Donate](https://img.shields.io/badge/Donate-0070ba?style=for-the-badge&logo=paypal&logoColor=white)](https://streamelements.com/nonamefound/tip)
[![Subscribe on Twitch](https://img.shields.io/badge/Subscribe%20on%20Twitch-9146ff?style=for-the-badge&logo=twitch&logoColor=white)](https://www.twitch.tv/subs/nonamefound)
[![Gadgets Store](https://img.shields.io/badge/Gadgets%20Store-000000?style=for-the-badge&logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAYAAAByDd%2BUAAADzUlEQVR4nLxWTUxTQRD%2B%2BnivLXAgAi0aBBRjRSJqNEq9eAATjWev%2Fh80MSbe1HgUjVeNUaOeNDF6lpD4gz9J1RZti1BIpCRUBBL%2BKX9aCu%2B5M3TJo7RNRGCSl327OzvfzDe7s6s6HOteWhQcNQwYABSLEKygGEKoIauGjgaLsyjfkBMrDWYGlbZV8a%2BLlvqW1QCVNmWkymqCIWHcZNuiSpDVotNsm1olk%2BI8C6y48Mmx5YqaCSwrKwtzc3OIxWLQdR2KosBms%2FHccglR04GR8ampKdjtdpRvLodm1RCfiaOntwf%2Fw76SCowii8X%2BYM%2BevWhs%2FAifzw%2Bf148bN25hcnISmqotREm69JkdpT61qehXk8HIyOzsLMZGp1B3%2FSaqdlQh3BlG49s3aGiox%2B%2FpOMbVceTk5GBmZgbT09O8Njc3F5qmYWJigterqspjyfQvAqQJyhkZO3fuGKqqdnK%2FqcmH5y%2BewekswqnTxzEwMACPx4Oy0lJmgaTpaxP6%2BnpRU1OL%2FPx8DAodr8%2FLwIswZKVhfpUsDA8P4vz5C7hz%2By6DETXSQ6%2F3C9zuA%2Bju7kb5lk24cvkK6upu8tylSxfx6PFD%2FIz0orCwEE%2BfPsGZsyfhcDjYThpKdRFdLlpavuP1m1eorTkkcjaB%2Bw%2FuIRgIiAid2LdvPwoKClBcvAFlZWULeSoR0ZaUlCIvL48B3n94lzKPiwBp6xPvHz94cOL4L05%2BR0cHrl27itk4UFN7kKMlne3bK%2BFybUN%2Ffz%2FnbpurApWVlfxPuW1vDy0cobSAZCwej8PhXIfqajcrt7e3sRGnGAuHw5yn4uKNcFcfEIAuQfNnZIucV1RUcPS0pqurS3yRlIBLjgV5t2H9PF3kQPP3Zt519D80NIQ24QDJ4cNHUFS0Ht%2F83xAMBoT%2BJk4BSSjUgmh0lDdMRkDinKrK1q0uziXlIhRq5UNPQtEHA36mfteu3TxGDJAO0b9DHCFd7AO%2FcIJ0ZDnMSClFU%2B12M3g0GkVnZydsVhsbII%2F9fj8bp6NDEolERE5zWF%2BOBUTEmmblNcmStGkMWK1WriTNzUH2fGRkmMco2uxsO0JtrfhCebNnYyw6Js5kP89%2F%2BuThzTQ%2BHhUb7QeXxFSVZtE5lFWBjMuzQxtG3hLUktdEraSK5iXdCSscnXlNRkplLZ2vjxY2IBfKWim9N19X5luE2nQ3StrrSXqbaqEEMVOWaiyVLAFMNm7u%2F8u1lE5XwRqLknhNyffjqogZQ0m05qfcioOZn4mqfEit1TNRMXSjnh%2FhiUixwpKwqROGoev1fwEAAP%2F%2FYS96FAAAAAZJREFUAwDZbiCuC53RGgAAAABJRU5ErkJggg%3D%3D)](https://nonamefound.lol/en-eur)

</div>

Donations are optional, and everyone gets the same features. Sharing the app, reporting bugs, suggesting features or contributing code helps just as much. ❤️

## Development

| Command | Purpose |
|---|---|
| `npm run demo` | Run with simulated platforms |
| `npm run dev` | Run with real connections |
| `npm run typecheck` | Type checking |
| `npm run build` | Build the app |
| `npm run dist` | Create the zip and portable exe |
| `npm run release -- --notes notes.md` | Build, check for personal data, and publish a GitHub release |

```text
src/
  main/          App process: logins, connectors, hub, updater
    platforms/   One folder per platform behind a shared interface
    integrations/ Streamlabs and StreamElements
  preload/       The narrow bridge between the app and the UI
  renderer/      React interface and theme
  shared/        Types and message parsing used on both sides
resources/       Icon, logos and the YouTube chat definition
scripts/         The release command
docs/media/      README images
```

To add a platform, implement the `Connector` interface in `src/main/platforms/connector.ts`, and convert its messages to the shared types. The UI needs no platform-specific changes.

Contributions are welcome. Please run `npm run typecheck` before opening a pull request, and never include real chat logs, tokens or the `user-data` folder.

## License

[MIT](LICENSE). Use it, change it and share it.

<sub>NoName's Multichat Control is an independent project, and isn't affiliated with or endorsed by Twitch, YouTube, Kick, Streamlabs, StreamElements, Fourthwall, BetterTTV, 7TV or FrankerFaceZ. All trademarks belong to their owners.</sub>
