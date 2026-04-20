# CoinSprite Reward + Milestone Bot

A Discord bot for milestone giveaway tracking and invite-based rewards.

## Slash Commands
- `/start-giveaway-milestone`
  - Opens a modal for giveaway reward, winner count, and milestone user count.
  - Posts a Components V2 milestone panel.
  - Refreshes automatically.
  - Counts only real users (bots ignored).
- `/invite-points`
  - Shows the user's current Invite Points.
- `/reward-inventory`
  - Shows the user's current reward inventory.

## Invite Reward System
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
- 0–29 members: 250 Clan Rerolls, 120 Race Rerolls, 120 Trait Rerolls
- 30–49 members: 500 Clan Rerolls, 135 Race Rerolls, 135 Trait Rerolls
- 50+ members: 1000 Clan Rerolls, 150 Race Rerolls, 150 Trait Rerolls

## Console-style PR Commands (Discord message commands)
Use in a guild channel with Administrator permission:
- `PR RI {userID}`
- `PR add/remove {userID} {item} {amount}`
- `PR blacklist add/remove {userID} {reason}`

Supported item aliases (case-insensitive):
- Clan Reroll, Clan Rerolls, CRR
- Trait Reroll, Trait Rerolls, TRR
- Race Reroll, Race Rerolls, RRR
- Invite Point, Invite Points, IP

## Persistence
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
