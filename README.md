# CoinSprite

CoinSprite is a focused Discord service for a seed RNG economy, multiplayer casino games, and community leveling. The runtime contains three product surfaces:

- **Seed RNG economy** — secure crop rolls, persistent crop/item/pet inventories and balances, a global item shop, consumable effects, pet hatching/equipment, selling, filtering, pagination, and capacity upgrades.
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

Bot and panel deployments must both install with `npm ci`; do not use `npm install` in either deployment. Use `npm run deploy:bot` for the Discord gateway, command registration, and RNG schedulers. Use `npm run deploy:panel` for the web panel only. `npm start` deliberately runs the combined role for local development.

The panel role fails closed: it does not register Discord commands, attach Discord interaction/message handlers, or start game schedulers. Production should run exactly **one** `deploy:bot` scheduler-enabled replica; panel replicas may scale separately. Startup diagnostics report the runtime role, scheduler state, instance identity, PID, hostname, shard, and service name without logging credentials.

For pixel-identical level cards, deploy the bot and panel from the same commit and `package-lock.json`, run `npm ci` in both deployments, and set identical `LEVEL_CARD_RENDER_SECRET` and `COINSPRITE_BUILD_VERSION` values. Point the bot's `PUBLIC_WEB_BASE_URL` at the panel. The renderer rejects a panel whose build, renderer, or installed-font manifest differs from the bot instead of falling back to a stale local card.

Production verification:

1. Confirm bot and panel startup diagnostics report the same `build`, renderer `version`, and `font-manifest` values.
2. Save a card with distinctive username font settings and wait for **Exact Discord render** to load in the profile editor.
3. Run `/level` and confirm diagnostics report `source=authoritative` with the same `design` hash and `saved-at` value as the panel render.
4. Download both PNGs and compare their SHA-256 hashes and decoded pixels; both must match with zero differing pixels.
5. Temporarily make the panel renderer unavailable and verify `/level` returns the temporary render error without an attachment.

## Configuration

Guild settings are stored in `data/server-config.json`, while member XP is stored atomically in `data/leveling.json`.

Every optional feature defaults locked and disabled for every server; the bot owner can independently unlock Leveling and the RNG Game from the fleet's **Feature access** dropdown. When CoinSprite joins a server, it creates that server's configuration and makes it available in the owner panel.

The dashboard lets Discord administrators configure unlocked features:

- XP range, cooldown, progression curve, maximum level, opt-in channel multipliers, and role XP boosts;
- a live Discord-markdown Components V2 composer with containers, accent colors, thumbnails, `{separator}` lines, and image galleries;
- stackable or highest-only milestone role rewards, with server role colors shown in selectors.
- multi-channel and forum access settings for the RNG Game, including cooldown-bypass roles.

The focused application commands include the Leveling commands and the RNG/economy commands `/roll`, `/inventory`, `/sell`, `/balance`, `/auto-roll`, `/upgrade`, `/index`, `/stat`, `/calculate-chance`, `/shop`, `/use`, `/g-rps`, and `/g-roulette`. RNG prefix commands are `c!roll`, `c!inventory`, `c!sell`, `c!balance`, `c!auto roll`, `c!auto-roll`, `c!upgrade`, `c!index`, `c!stat`, `c!calculate chance`, `c!shop`, and `c!use <item name> [amount]`. Prefix and slash entry points share the same services, locks, persistence, modifiers, and cooldowns.

### European Roulette

`/g-roulette` opens a persistent single-zero European Roulette table for solo house play or the host plus one to three invited players. Each player escrows independent token bets and settles against the house. The table supports Straight, Split, Street, Corner, Six Line, both zero Trios, First Four, all Dozens and Columns, Red/Black, Even/Odd, and Low/High. Individual and per-player round stake are capped at 1,000 token value, with at most 12 distinct positions. Undo, clear, leave, cancellation, and expiry refund unresolved escrow transactionally; completed bets use standard European total-return multipliers. Roulette and RPS share one active-casino-player lock so a wallet cannot escrow into both games simultaneously.

### Shop, items, and pets

`/shop` and `c!shop` open an owner-bound Components V2 shop with one cached 1920×1080 landscape composite PNG per page, arranged as three columns by two rows. A two-item final page is centered without stretching or filler entries. Every player sees and pays the same catalogue price; Luck, BIG, pets, and active consumables never personalize the rendered Shop or checkout. Global stock is replaced every 30 minutes on fixed wall-clock boundaries; every catalogue item independently rolls its restock chance and inclusive stock range. Restock epochs and stock survive restarts, and purchase confirmation rechecks the current catalogue version, fixed price, stock, and BigInt balance in one idempotent transaction.

`/use item:<item> amount:<amount>` and `c!use <item name> [amount]` consume owned items atomically. Timed mushrooms target one crop rarity, timed sprinklers improve crop weight and BIG chance, watering cans add successful-roll charges, and Common Eggs hatch pets. Reusing the same timed item extends duration without multiplying its strength. Secret Mushroom adds a fixed 0.025 percentage points to the base Secret chance and cannot be amplified by Luck, pets, or repeat use. Different mushroom rarities may coexist, only one sprinkler may be active, and watering-can charges are consumed only after a crop instance commits. Manual and Auto Rolls resolve the same persisted modifier snapshot; combined crop weight is capped at ×2.50, effective BIG chance at 15%, pet-only value bonus at 20%, and Common probability has a 10% floor.

The unified `/inventory` and `c!inventory` response has Crops, Items, and Pets views. Item storage is unlimited. The Items view summarizes active expirations and watering-can charges, while the Pets view shows final combined bonuses after stacking and caps. Pet slot 1 is free, slot 2 costs 10,000,000 Sheckles, and slot 3 costs 50,000,000 Sheckles. Only equipped pet instances grant perks, so duplicate species can fill multiple slots only when the player owns enough copies.

Egg animations live in `images/egg_open`. The current supplied filename convention is rarity-prefixed PascalCase: `CFrog.gif`, `CBunny.gif`, `UCOwl.gif`, `MDeer.gif`, `RTurtle.gif`, `LRobin.gif`, `LBee.gif`, `LButterfly.gif`, `MMonkey.gif`, `MFirefly.gif`, `MGoldenDragonfly.gif`, `MUnicorn.gif`, and `LBear.gif`. The centralized pet catalogue maps species to these filenames. A missing species animation falls back to `default.gif`, then to the pet emoji PNG.

Signed-in players can also open `/chances` to compare every visible crop's base roll probability with the probability adjusted for their current Luck tier. Undiscovered crops remain masked, and Secret crops are excluded from the page and API response.

All dashboard writes require a same-session CSRF token. Guild edits require Discord Administrator permission; fleet controls require a configured owner identity or the Discord application owner.

## Validation

```bash
npm test
npm run report:rng-items-pets
npm run report:shop-balance
npm run report:pet-value
```

The test suite covers multi-server onboarding, runtime-role isolation, RNG rolls and auto-roll idempotency, shop restocks and purchases, item effects, pet hatching and slots, roulette settlement and rendering, manual/Auto modifier parity, upgrades, discoveries and index rendering, leveling curves and Components V2 payloads, configuration security, persistence, live metrics, and permissions. The deterministic reports print fixed-price Shop and pet-value checkpoints, verify restock scarcity, Super-over-Legendary ordering, expected uplift, fixed-point egg odds, and money-loop safety, enumerate all three-pet combinations, and fail if probability or modifier caps are violated.
