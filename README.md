# CoinSprite

CoinSprite is a focused Discord service for Grow a Garden stock alerts and community leveling. The runtime contains three product surfaces:

- **GAG stock** — live seed, gear, crate, weather, moon, sell-price, update, and Fall Harvest alerts.
- **Leveling** — anti-spam message XP, level-up cards, leaderboards, ignored channels, and milestone roles.
- **Owner panel** — bot health, connected guilds, enable/disable controls, and a live operational console.

Tickets, moderation, giveaways, games, invite rewards, and other general-purpose dashboard modules are not loaded by the application.

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

3. Add the exact redirect URI to the Discord Developer Portal and enable the **Message Content Intent** for message XP.
4. Run `npm start` and open `http://127.0.0.1:3000/admin`.

For production, terminate TLS through a reverse proxy, bind the app to `127.0.0.1`, and set `ADMIN_COOKIE_SECURE=true`.

## Configuration

Guild settings are stored in `data/server-config.json`, while member XP is stored atomically in `data/leveling.json`.

The dashboard lets Discord administrators configure:

- destinations for seed, gear, crate, weather, moon, sell, role-selection, and update feeds;
- rarity and sell-multiplier filters;
- Fall Harvest feed participation;
- automatic notification-role synchronization;
- XP range, cooldown, progression curve, maximum level, and ignored channels;
- Components V2 level-up announcements and stackable or highest-only role rewards.

The focused application commands are `/stock-set-up`, `/level`, `/leaderboard`, `/level-set`, `/xp-add`, and `/leveling-setup`.

All dashboard writes require a same-session CSRF token. Guild edits require Discord Administrator permission; fleet controls require a configured owner identity or the Discord application owner.

## Validation

```bash
npm test
```

The test suite covers GAG stock delivery and deduplication, leveling curves and Components V2 payloads, configuration security, persistence, live metrics, permissions, role assignment, Fall Harvest handling, and update announcements.
