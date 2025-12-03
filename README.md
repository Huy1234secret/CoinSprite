# CoinSprite Discord Bot

A simple Discord bot written in JavaScript that provides a `/roll` command to award $10 giftcards based on a 1% chance and announces remaining prizes.

## Features
- Slash command `/roll` with a 24-hour user-specific cooldown.
- 1% chance to win a $10 giftcard with celebratory messaging.
- Automatic announcements to channel `1372572234949853367` when there is only one giftcard left or when all have been claimed.
- Persistent tracking of remaining giftcards in `data/state.json`.

## Setup
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment**
   - Copy `.env.example` to `.env` and set `DISCORD_TOKEN` to your bot token.

3. **Run the bot**
   ```bash
   npm start
   ```

## Notes
- Update `TOTAL_GIFTCARDS` and `ANNOUNCEMENT_CHANNEL_ID` in `index.js` to fit your event specifics.
- State is stored locally; delete `data/state.json` to reset the event.
