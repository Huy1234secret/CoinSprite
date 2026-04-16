# CoinSprite Milestone Giveaway Bot

A Discord bot focused on milestone-based giveaway tracking.

## Command
- `/start-giveaway-milestone`
  - Opens a modal form with:
    - Giveaway Reward (long paragraph)
    - Winner (number only)
    - User milestone (number only)
  - Posts a Components V2 giveaway panel.
  - Automatically refreshes every 10 minutes.
  - Counts only real users (bots ignored).
  - When milestone is reached, the old panel is deleted and replaced with a reached panel that pings `<@&1493901068688429207>`.

## Persistence
Active giveaway panel data is stored in `data/milestone-state.json` so progress survives bot restarts/crashes.

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env`:
   ```env
   DISCORD_TOKEN=your_token_here
   ```
3. Run bot:
   ```bash
   npm start
   ```
