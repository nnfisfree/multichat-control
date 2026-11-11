/** Twitch chat commands the app runs through Twitch's API, for the help list and suggestions. */
export const TWITCH_COMMANDS: { name: string; usage: string; description: string }[] = [
  { name: '/raid', usage: '/raid channel', description: 'Raid another channel' },
  { name: '/raidnow', usage: '/raidnow', description: 'Send the raid without waiting for the countdown' },
  { name: '/unraid', usage: '/unraid', description: 'Cancel the raid' },
  { name: '/pin', usage: '/pin [5m] message', description: 'Send and pin a message, until the stream ends or for 30 s to 30 min' },
  { name: '/unpin', usage: '/unpin', description: 'Remove the pinned message' },
  { name: '/announce', usage: '/announce message', description: 'Send an announcement (also /announceblue, green, orange, purple)' },
  { name: '/shoutout', usage: '/shoutout channel', description: 'Give a shoutout (also /so)' },
  { name: '/timeout', usage: '/timeout name [10m] [reason]', description: 'Time someone out (1 s to 2 weeks, 10 min if no time)' },
  { name: '/untimeout', usage: '/untimeout name', description: 'Remove a timeout' },
  { name: '/ban', usage: '/ban name [reason]', description: 'Ban someone' },
  { name: '/unban', usage: '/unban name', description: 'Unban someone' },
  { name: '/warn', usage: '/warn name reason', description: 'Send someone a warning they must acknowledge' },
  { name: '/clear', usage: '/clear', description: 'Clear chat for everyone' },
  { name: '/slow', usage: '/slow [30]', description: 'Slow mode, 3 to 120 seconds (/slowoff)' },
  { name: '/followers', usage: '/followers [10m]', description: 'Followers-only chat (/followersoff)' },
  { name: '/subscribers', usage: '/subscribers', description: 'Subscribers-only chat (/subscribersoff)' },
  { name: '/emoteonly', usage: '/emoteonly', description: 'Emote-only chat (/emoteonlyoff)' },
  { name: '/uniquechat', usage: '/uniquechat', description: 'No repeated messages (/uniquechatoff)' },
  { name: '/shield', usage: '/shield', description: 'Shield mode (/shieldoff)' },
  { name: '/mod', usage: '/mod name', description: 'Make someone a moderator (/unmod)' },
  { name: '/vip', usage: '/vip name', description: 'Make someone a VIP (/unvip)' },
  { name: '/mods', usage: '/mods', description: 'List the moderators' },
  { name: '/vips', usage: '/vips', description: 'List the VIPs' },
  { name: '/user', usage: '/user name', description: 'Open their user card' },
  { name: '/commercial', usage: '/commercial [60]', description: 'Run an ad, up to 180 seconds' },
  { name: '/marker', usage: '/marker [description]', description: 'Add a stream marker for highlights' },
  { name: '/title', usage: '/title new title', description: 'Change the stream title' },
  { name: '/game', usage: '/game name', description: 'Change the category (also /category)' },
  { name: '/poll', usage: '/poll Question | A | B [| 2m]', description: 'Start a poll (/endpoll)' },
  { name: '/prediction', usage: '/prediction Question | A | B [| 2m]', description: 'Start a prediction' },
  { name: '/color', usage: '/color blue_violet', description: 'Change your name colour' },
  { name: '/w', usage: '/w name message', description: 'Whisper someone (also /whisper)' },
  { name: '/block', usage: '/block name', description: 'Block someone (/unblock)' }
]

/** Every command word the app handles for Twitch, including the variants listed in the help. */
export const TWITCH_COMMAND_NAMES = new Set([
  ...TWITCH_COMMANDS.map((c) => c.name),
  '/announceblue', '/announcegreen', '/announceorange', '/announcepurple', '/so', '/slowoff', '/followersoff',
  '/subscribersoff', '/emoteonlyoff', '/uniquechatoff', '/shieldoff', '/unmod', '/unvip', '/category', '/endpoll',
  '/whisper', '/unblock'
])
