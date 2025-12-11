# CoinSprite Discord Bot

A simple Discord bot written in JavaScript that powers interactive slash commands like `/hunt` and `/shop-view`.

## Features
- `/hunt` lets users view and interact with their hunting profile.
- `/shop-view` generates a preview image of the current shop rotation.

## Setup
1. **Install dependencies**
   ```bash
   ./scripts/install-deps.sh
   ```
   - Pass `--upgrade-npm` (or set `UPGRADE_NPM=1`) to let the script upgrade npm to the latest pinned minor version if your local installation is older.
2. **Configure environment**
   - Copy `.env.example` to `.env` and set `DISCORD_TOKEN` to your bot token.

3. **Run the bot**
   ```bash
   npm start
   ```

## Notes
- Update `TOTAL_GIFTCARDS` and `ANNOUNCEMENT_CHANNEL_ID` in `index.js` to fit your event specifics.
- State is stored locally; delete `data/state.json` to reset the event.
