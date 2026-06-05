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
  - A player cannot submit two accepted words in a row; they must wait for another player.
  - Repeated, unknown, misspelled, wrong-length, or wrong-chain words mute the player in that channel and add role `1512488707461091420` for 1 minute.
  - English words are checked online with DictionaryAPI.dev and cached in memory; temporary dictionary lookup failures do not punish the player.

## Message Context Menu Commands
- `Reply with Bot Message`
  - Administrator-only message context menu command for replying with the bot without copying or entering a message ID.
  - Right-click or long-press the target message, choose Apps, choose `Reply with Bot Message`, then type the bot reply in the modal.

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
- `!DM {userID} {message} {yes/no}`
- `!add/remove {userID} {item} {amount}`
- `!blacklist add/remove {userID} {reason}`
- `!invitee-blacklist add/remove {userID} {reason}`

Supported item aliases (case-insensitive):
- Clan Reroll, Clan Rerolls, CRR
- Trait Reroll, Trait Rerolls, TRR
- Race Reroll, Race Rerolls, RRR
- Invite Point, Invite Points, IP

## Persistence
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
   # Optional override for where the invitation rules message is posted.
   INVITATION_RULES_CHANNEL_ID=1494329296670425279
   ```
3. Run bot:
   ```bash
   npm start
   ```

## Ticket System
- The bot maintains a Components V2 support ticket panel in channel `1493971939545583836` on startup (`/ticket-panel` can force-refresh).
- Ticket types:
  - Guild Support
  - Claim Reward
  - Request role: Crew Member+
- Guild Support and Claim Reward create private ticket channels with staff action controls.
- Ticket actions include close + blacklist, transcript save, and delayed channel deletion.
- Closed ticket transcripts are sent to channel `1495788766600757418`.
- Crew Member+ role requests are sent to channel `1495714584437329940` with accept/deny review actions.
