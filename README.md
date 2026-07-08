# CoinSprite Reward + Milestone Bot

A Discord bot for milestone giveaway tracking and invite-based rewards.

## Slash Commands
- `/giveaway-start`
  - Opens a Components V2 giveaway setup panel with edit-message and edit-requirement controls.
  - Uses a modal for prize, notes, claim time, winner count, and hoster selection.
  - Asks for giveaway duration only after Start is pressed, then deletes the setup panel.
  - Starts a persistent giveaway with join checks, winner draws, claim windows, rerolls, and hoster claim DMs.
- `/delete giveaway giveaway_message_id:{message_id}`
  - Deletes a giveaway or giveaway setup by its main message id.
- `/giveaway-reroll giveaway_message_id:{message_id}`
  - Forces an active giveaway claim round to reroll immediately instead of waiting for the claim timer.
- `/giveaway-list`
  - Lists all current giveaways with linked giveaway message names.
- `/start-giveaway-milestone`
  - Opens a modal for giveaway reward, winner count, and milestone user count.
  - Posts a Components V2 milestone panel.
  - Refreshes automatically.
  - Counts only real users (bots ignored).
- `/invite-points`
  - Shows the user's current Invite Points.
- `/transcript-message amount:{1-100}`
  - Saves a transcript of the most recent messages from the current channel and sends it to the transcript channel.
- `/message channel:{channel} message:{text} [replyto:{message_id}]`
  - Administrator-only command that sends a bot message to the selected text channel, optionally as a reply to an existing message ID.
  - Sends the command confirmation ephemerally to the command user.
- `/word-chain`
  - Shows the current Word Chain game status.
  - The game auto-starts and is only playable in channel `1512480152410525958`.
  - Each game has 3 server hearts, a random fixed word length from 3 to 10 letters, and a 4-hour countdown.
  - Correct words reset the countdown. Timeout or invalid words cost 1 server heart.
  - The current match is saved in `data/word-chain-state.json` and restored after bot restarts.
  - The streak counts accepted chained words in the current match and resets to 0 after a timeout or invalid word penalty.
  - Accepted words award XP equal to the current word length, from 3x to 10x.
  - A player cannot submit two accepted words in a row; they must wait for another player.
  - Repeated, unknown, misspelled, wrong-length, or wrong-chain words restrict the player from Word Chain for the configured punishment duration without muting them in Discord.
  - Restricted attempts are deleted when possible and receive a private red restriction notice; if DMs are closed, the bot posts a short auto-deleting channel notice because Discord does not support ephemeral responses to regular messages.
  - The limited Word Chain mini event runs through July 11, 2026 at 22:00 UTC+7. Each accepted word independently rolls every in-stock prize at 10x the original chance, with +10% relative luck per 40 streak (capped at +100%).
  - Event inventory, the full `awards` history, a per-user `prizeSummary`, timing, and the reusable announcement message ID are stored in `data/word-chain-event.json`.
  - English words are checked across DictionaryAPI.dev, Wiktionary, and Datamuse, then cached in memory; a small fallback list covers valid words missing from those APIs, and temporary dictionary lookup failures do not punish the player.

## Message Context Menu Commands
- `Reply with Bot Message`
  - Administrator-only message context menu command for replying with the bot without copying or entering a message ID.
  - Right-click or long-press the target message, choose Apps, choose `Reply with Bot Message`, then type the bot reply in the modal.

## Warning System
- `/warn member points reason [expires] [evidence]` creates a persistent point-based warning case.
- `/warnings [member]` shows sanitized warning history; staff can inspect other members.
- `/case view|edit|pardon` manages auditable cases without deleting history.
- Administrators and the configured staff role can manage warnings.
- Active points can trigger configurable timeout, kick, ban, or staff-alert thresholds.
- New guilds default to 3 points = 1 hour, 5 = 24 hours, 8 = 7 days, and 10 = staff alert.
- Auto-Moderator `warn` actions create cases when the warning system is enabled. AI moderation never assigns points.
- Cases use schema v2 in `data/moderation-cases.json`: generic type/target/author fields, structured details, Discord message references, and append-only audit events.
- Schema v1 is backed up once before migration; invalid JSON is logged and left untouched instead of being reset.
- `/warn`, `/warnings`, and `/case` share Discord Components V2 response builders.
- The Cases API performs server-side filtering and pagination and hydrates target/author profiles.
- The web Moderator area has two workspaces: Auto Moderation (AI and links) and Moderation (warnings and cases), with a list/detail case workflow.
- Output channels route through `logging.categories.<category>` and event overrides; operational channels remain with their owning feature.
- File-backed configuration and moderation data use serialized atomic replacement writes with migration backups and recovery logs.
- AI moderation input context, character caps, and output token caps are unchanged.

## Invite Reward System
- Status: **disabled in code** (`INVITATION_REWARDS_ENABLED = false` in `src/inviteRewardsManager.js`).
- Tracks invite usage and awards rewards only when:
  - Invited account age is at least 4 days.
  - Reward tier is active based on current member count.
- Per eligible invite:
  - +1 Invite Point.
  - Tier-based Clan / Race / Trait Rerolls.
- Invitation reward cap:
  - When the server reaches 150 members, reroll rewards end.
  - Eligible invites still add Invite Points after the cap is reached.
- A green invitation-rules message is maintained in channel `1494329296670425279` and auto-updated when member tiers change.

### Reward tiers
- 0Ã¢â‚¬â€œ29 members: 250 Clan Rerolls, 120 Race Rerolls, 120 Trait Rerolls
- 30Ã¢â‚¬â€œ49 members: 500 Clan Rerolls, 135 Race Rerolls, 135 Trait Rerolls
- 50+ members: 1000 Clan Rerolls, 150 Race Rerolls, 150 Trait Rerolls

## Prefix Commands
Use these in a guild text channel:
- `!ping` - Shows current bot latency and Discord API ping in milliseconds.
- `!level` / `!rank` - Shows your level card.

## Console-style `!` Commands (Discord message commands)
Use in a guild channel with Administrator permission:
- `!RI {userID}` (or `!IR {userID}`)
- `!DM [userID1,userID2,...] {message} {yes/no}` - Sends the message to up to 25 users; `yes` mentions each recipient and `no` sends plain text. A single unbracketed user ID remains supported.
- `!add/remove {userID} {item} {amount}`
- `!blacklist add/remove {userID} {reason}`
- `!invitee-blacklist add/remove {userID} {reason}`

Supported item aliases (case-insensitive):
- Clan Reroll, Clan Rerolls, CRR
- Trait Reroll, Trait Rerolls, TRR
- Race Reroll, Race Rerolls, RRR
- Invite Point, Invite Points, IP

## Persistence
- Server config: `data/server-config.json`
  - Created automatically on startup from the defaults in `src/serverConfig.js`.
  - Use `data/server-config.example.json` as the editable shape/reference.
  - Keyed by Discord guild/server ID under `guilds`.
  - Stores server-specific channel IDs, role IDs, XP channels, level role rewards, invite reward tiers, giveaway limits, word-chain settings, ticket settings, and command log target.
- Giveaway state: `data/giveaway-state.json`
- Milestone state: `data/milestone-state.json`
- Invite reward state: `data/invite-rewards-state.json`

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   ```env
   DISCORD_TOKEN=your_token_here
   # Optional override for the default guild used when data/server-config.json is first generated.
   DEFAULT_GUILD_ID=1493901002519347290
   ```
3. Review or edit server config:
   ```bash
   cp data/server-config.example.json data/server-config.json
   ```
   Add more guild IDs under `guilds` and set `enabled: true` for every server the bot should serve.
4. Run bot:
   ```bash
   npm start
   ```

## Admin Web Panel
The bot can also run a small Discord-login admin panel from the same process. It only allows a user to edit guild config when the bot can confirm that Discord member has Administrator permission in that guild.

Admin sessions are stored in `data/admin-sessions.json` and expire after three days. The dashboard can list guild channels, categories, roles, and active or archived forum threads that are visible to the bot.
Word Chain settings include warning or punishment behavior for repeated and wrong-start words. Its XP formula supports `wordLength`, `streak`, arithmetic, parentheses, and the `min`, `max`, `round`, `floor`, `ceil`, and `abs` functions. Invalid formulas safely fall back to `wordLength`.
The Leveling tab groups XP earning, role rewards, and level-up announcements. Every guild inherits a default Components V2 level-up container until it saves an override. Message templates support member/server placeholders, `<separator>`, and conditions such as `<if<level>==10,"shown","hidden">`; optional thumbnails and images remain inside the container.
The Tickets tab manages the launcher channel and message, ticket types, role and permission overwrites, transcripts, ticket messages, staff controls, and creating or closing forms. Form builders follow Discord's component limits and allow up to five questions per form.

Add these values to `.env` to enable it:
```env
ADMIN_WEB_HOST=0.0.0.0
ADMIN_WEB_PORT=3000
DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_CLIENT_SECRET=your_discord_application_client_secret
DISCORD_REDIRECT_URI=http://your_server_ip:3000/auth/discord/callback
SESSION_SECRET=use_a_long_random_secret_here
ADMIN_COOKIE_SECURE=false
```

`ADMIN_WEB_HOST=0.0.0.0` exposes the panel through the Vultr instance network interfaces. Open TCP port `3000` in the Vultr firewall and Ubuntu firewall, then visit `http://your_server_ip:3000`. In the Discord Developer Portal, add the exact `DISCORD_REDIRECT_URI` to the application's OAuth2 redirect URLs.

For production, put Nginx or Caddy in front of `127.0.0.1:3000`, use an HTTPS domain, set `ADMIN_WEB_HOST=127.0.0.1`, and set `ADMIN_COOKIE_SECURE=true`.

## Ticket System
- Ticket definitions are stored per guild in `data/server-config.json`; open-ticket state and generated transcripts remain file-backed runtime data.
- The launcher can use a selection panel or buttons and has its own editable Components V2 message.
- Each ticket type can override its category, transcript channel, staff roles, blacklist role, channel permissions, opening message, admin panel, and forms.
- Admin controls support close, transcript, delete, blacklist, and move-to actions. Close, transcript, and delete always execute in that order when combined.
- `/ticket-action` provides the same staff actions inside a ticket channel when its admin panel is disabled.
- New guild configs start with no ticket types. The original CoinSprite guild is migrated with Guild Support, Request Giveaway, and Guild Join Request definitions.
- `/ticket-panel` force-refreshes the configured launcher message.
