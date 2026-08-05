# CoinSprite Stock Control

CoinSprite is a focused Discord service for Grow a Garden stock alerts. The runtime intentionally contains two product surfaces:

- **GAG stock** — live seed, gear, crate, weather, moon, sell-price, update, and Fall Harvest alerts.
- **Owner panel** — bot health, connected guilds, enable/disable controls, and a live operational console.

Legacy leveling, tickets, moderation, giveaways, games, invite rewards, and general-purpose dashboard modules are not loaded by the application.

## Setup

1. Install dependencies with `npm install`.
2. Create `.env` with:

   ```env
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_discord_application_id
   DISCORD_CLIENT_SECRET=your_discord_oauth_secret
   DISCORD_REDIRECT_URI=http://127.0.0.1:3000/auth/discord/callback
   SESSION_SECRET=use_a_long_random_secret
   ADMIN_WEB_HOST=127.0.0.1
   ADMIN_WEB_PORT=3000
   ADMIN_COOKIE_SECURE=false
   OWNER_USER_IDS=your_discord_user_id
   ```

3. Add the exact redirect URI to the Discord Developer Portal.
4. Run `npm start` and open `http://127.0.0.1:3000/admin`.

For production, terminate TLS through a reverse proxy, bind the app to `127.0.0.1`, and set `ADMIN_COOKIE_SECURE=true`.

## Configuration

Guild configuration is stored in `data/server-config.json`. On first launch after this update, CoinSprite creates a one-time `server-config.json.pre-stock-only.bak` backup and migrates the active file to the stock-only schema.

The dashboard lets Discord administrators configure:

- destinations for seed, gear, crate, weather, moon, sell, role-selection, and update feeds;
- rarity and sell-multiplier filters;
- Fall Harvest feed participation;
- automatic notification-role synchronization.

All dashboard writes require a same-session CSRF token. Guild edits require Discord Administrator permission; fleet controls require a configured owner identity or the Discord application owner.

## Validation

```bash
npm test
```

The retained GAG stock tests cover payload parsing, deduplication, schedules, source retries, permissions, role assignment, Fall Harvest handling, and update announcements.
