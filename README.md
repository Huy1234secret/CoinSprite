# CoinSprite

CoinSprite is a focused Discord community service. The runtime contains these product surfaces:

- **Leveling** — anti-spam message XP, channel and role boosts, scheduled claimable XP crates, live-composed messages, leaderboards, and milestone roles.
- **Counting and Bronze balance** — turn-safe counting with persistent rewards, a text balance lookup, and an application-command balance lookup.
- **Message Templates** — reusable Components V2 messages with buttons, dropdowns, role actions, ephemeral responses, and direct messages.
- **Reaction Roles** — button and dropdown role menus with permission-safe publishing and runtime verification.
- **Welcome Messages** — configurable join, leave, and server-boost messages.
- **Owner panel** — bot health, connected guilds, per-server Leveling access, enable/disable controls, and a live operational console.

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

Bot and panel deployments must both install with `npm ci`; do not use `npm install` in either deployment. Use `npm run deploy:bot` for the Discord gateway, command registration, and scheduled bot jobs. Use `npm run deploy:panel` for the web panel only. `npm start` deliberately runs the combined role for local development.

The panel role fails closed: it does not register Discord commands, attach Discord interaction/message handlers, or start scheduled bot jobs. Production should run exactly **one** `deploy:bot` scheduler-enabled replica; panel replicas may scale separately. Startup diagnostics report the runtime role, scheduler state, instance identity, PID, hostname, shard, and service name without logging credentials.

For pixel-identical level cards, deploy the bot and panel from the same commit and `package-lock.json`, run `npm ci` in both deployments, and set identical `LEVEL_CARD_RENDER_SECRET` and `COINSPRITE_BUILD_VERSION` values. Point the bot's `PUBLIC_WEB_BASE_URL` at the panel. The renderer rejects a panel whose build, renderer, or installed-font manifest differs from the bot instead of falling back to a stale local card.

Production verification:

1. Confirm bot and panel startup diagnostics report the same `build`, renderer `version`, and `font-manifest` values.
2. Save a card with distinctive username font settings and wait for **Exact Discord render** to load in the profile editor.
3. Run `/level` and confirm diagnostics report `source=authoritative` with the same `design` hash and `saved-at` value as the panel render.
4. Download both PNGs and compare their SHA-256 hashes and decoded pixels; both must match with zero differing pixels.
5. Temporarily make the panel renderer unavailable and verify `/level` returns the temporary render error without an attachment.

## Configuration

Guild settings are stored in `data/server-config.json`, while member XP is stored atomically in `data/leveling.json`.

Every optional feature defaults locked and disabled for every server. The bot owner can manage Leveling access from the fleet's **Feature access** dropdown. When CoinSprite joins a server, it creates that server's configuration and makes it available in the owner panel.

The dashboard lets Discord administrators configure unlocked features:

- XP range, cooldown, progression curve, maximum level, opt-in channel multipliers, and role XP boosts;
- a live Discord-markdown Components V2 composer with containers, accent colors, thumbnails, `{separator}` lines, and image galleries;
- scheduled XP crates with a global drop channel plus optional per-crate fallbacks, images, XP ranges, guided `s`/`m`/`h`/`d` duration inputs, chances, claim limits, optional despawn timers, repeat-claim controls, colors, editable drop/claim messages (including `{list_claimed_user}`), and zero-XP test sends;
- stackable or highest-only milestone role rewards, with server role colors shown in selectors.

The published application-command surface contains the Counting balance command and the commands for enabled Leveling features. Counting messages and the `csbalance` text command share the same persistent Bronze balance.

All dashboard writes require a same-session CSRF token. Guild edits require Discord Administrator permission; fleet controls require a configured owner identity or the Discord application owner.

## Validation

```bash
npm test
```

The test suite covers multi-server onboarding, runtime-role isolation, Counting persistence and turn safety, Leveling curves and Components V2 payloads, XP drops, Message Templates, Reaction Roles, Welcome Messages, configuration security, live metrics, and permissions.
