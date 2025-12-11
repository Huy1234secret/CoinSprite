# CoinSprite Discord Bot

A simple Discord bot written in JavaScript that serves as a starting point for building out slash commands with Discord.js.

## Features
- Discord.js client with automatic command registration from the `commands/` directory.
- Safe error handling helper for user interactions.

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
