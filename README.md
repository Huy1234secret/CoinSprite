# CoinSprite

CoinSprite is a focused Discord service for Grow a Garden stock alerts, a seed RNG economy, and community leveling. The runtime contains four product surfaces:

- **GAG stock** — live seed, gear, crate, weather, moon, sell-price, update, and Fall Harvest alerts.
- **Seed RNG economy** — secure crop rolls, persistent inventories and balances, selling, filtering, pagination, and capacity upgrades.
- **Farming game** — nine persistent plots, timestamp-based crop growth, planting, harvesting, shoveling, rendered farm images, and stack-based farming items.
- **Leveling** — anti-spam message XP, channel and role boosts, live-composed level-up cards, leaderboards, and milestone roles.
- **Owner panel** — bot health, connected guilds, per-server feature access, enable/disable controls, and a live operational console.

Tickets, moderation, giveaways, invite rewards, and other general-purpose dashboard modules are not loaded by the application.

## Setup

1. Install the lockfile-defined dependencies with `npm ci`.
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
   PUBLIC_WEB_BASE_URL=http://127.0.0.1:3000
   LEVEL_CARD_RENDER_SECRET=use_the_same_dedicated_secret_for_bot_and_panel
   COINSPRITE_BUILD_VERSION=the_deployed_git_commit_sha
   OWNER_USER_IDS=your_discord_user_id
   ```

3. Add the exact redirect URI to the Discord Developer Portal and enable the **Message Content Intent** for message XP.
4. Run `npm start` for the combined local runtime and open `http://127.0.0.1:3000/admin`.

For production, terminate TLS through a reverse proxy, bind the app to `127.0.0.1`, and set `ADMIN_COOKIE_SECURE=true`.

Bot and panel deployments must both install with `npm ci`; do not use `npm install` in either deployment. Use `npm run deploy:bot` for the Discord gateway, command registration, GAG stock poster, update poster, and RNG auto-roll scheduler. Use `npm run deploy:panel` for the web panel only. `npm start` deliberately runs the combined role for local development.

The panel role fails closed: it does not register Discord commands, attach Discord interaction/message handlers, or start any poster or scheduler. The GAG stock state is local rather than a shared distributed lease, so production must run exactly **one** `deploy:bot` scheduler-enabled replica. Panel replicas may scale separately. A startup diagnostic reports the runtime role, whether the stock poster is enabled, instance identity, PID, hostname, shard, and service name without logging credentials. Verify production logs contain one `role=bot stockPoster=enabled` instance and only `role=panel stockPoster=disabled` for panel services.

For pixel-identical level cards, deploy the bot and panel from the same commit and `package-lock.json`, run `npm ci` in both deployments, and set identical `LEVEL_CARD_RENDER_SECRET` and `COINSPRITE_BUILD_VERSION` values. Point the bot's `PUBLIC_WEB_BASE_URL` at the panel. The renderer rejects a panel whose build, renderer, or installed-font manifest differs from the bot instead of falling back to a stale local card.

Production verification:

1. Confirm bot and panel startup diagnostics report the same `build`, renderer `version`, and `font-manifest` values.
2. Save a card with distinctive username font settings and wait for **Exact Discord render** to load in the profile editor.
3. Run `/level` and confirm diagnostics report `source=authoritative` with the same `design` hash and `saved-at` value as the panel render.
4. Download both PNGs and compare their SHA-256 hashes and decoded pixels; both must match with zero differing pixels.
5. Temporarily make the panel renderer unavailable and verify `/level` returns the temporary render error without an attachment.

## Configuration

Guild settings are stored in `data/server-config.json`, while member XP is stored atomically in `data/leveling.json`.

GAG Stock is always unlocked. Every optional feature defaults locked and disabled for every server; the bot owner can unlock Leveling from the fleet's **Feature access** dropdown.

The dashboard lets Discord administrators configure unlocked features:

- destinations for seed, gear, crate, weather, moon, sell, role-selection, and update feeds;
- rarity and sell-multiplier filters;
- Fall Harvest feed participation;
- automatic notification-role synchronization;
- XP range, cooldown, progression curve, maximum level, opt-in channel multipliers, and role XP boosts;
- a live Discord-markdown Components V2 composer with containers, accent colors, thumbnails, `{separator}` lines, and image galleries;
- stackable or highest-only milestone role rewards, with server role colors shown in selectors.

The focused application commands include `/stock-set-up`, the Leveling commands, the RNG/economy commands `/roll`, `/inventory`, `/sell`, `/balance`, `/auto-roll`, `/upgrade`, and `/index`, plus Farming Game commands `/my-farm` and `/my-inventory`. Farming commands use the same per-server feature lock and allowed-channel policy as the RNG game. RNG prefix commands are `c!roll`, `c!inventory`, `c!sell`, `c!balance`, `c!auto roll`, `c!auto-roll`, `c!upgrade`, and `c!index`. Prefix and slash entry points share the same services, locks, persistence, and cooldowns.

All dashboard writes require a same-session CSRF token. Guild edits require Discord Administrator permission; fleet controls require a configured owner identity or the Discord application owner.

## Validation

```bash
npm test
```

The test suite covers GAG stock delivery and duplicate convergence, runtime-role isolation, RNG rolls and auto-roll idempotency, Farming Game persistence and rendering, upgrades, discoveries and index rendering, leveling curves and Components V2 payloads, configuration security, persistence, live metrics, permissions, role assignment, Fall Harvest handling, and update announcements.
