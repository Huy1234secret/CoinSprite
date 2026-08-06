# GAG2 stock poster

Automatic Grow a Garden 2 stock feed.

- Posts to the per-guild channels configured in the dashboard `Gag2 stock` tab.
- Sends separate Discord Components V2 messages for seed, gear, crate, weather, moon prediction, and sell price changes.
- Uses only the configured Garden Valley/Fall Harvest `gag.gg` stock feeds, the Garden Valley fruit feed, and `https://api.gag2.gg/api/live/weather`; no legacy stock or sell fallback is mixed into a cycle.
- Seed, gear, and crate checks run at second `:01` of every UTC+7 five-minute boundary. Sell checks run at second `:01` of every UTC+7 ten-minute boundary. A stale or unavailable boundary response is retried every two seconds for a short bounded window without posting the old snapshot.
- Requests use Node's native HTTPS client to avoid intermittent public-endpoint challenges. A temporary 403 retries the same approved URL and never switches sources.
- Source failures stay silent: no API URL, HTTP status, or source error is sent to Discord or the owner console. Startup removes recent legacy source-error cards from every configured stock destination, including disabled servers.
- Runtime state is stored in ignored `data/gag2-stock-poster.json` to avoid reposting unchanged feed data after restart.
- Announcement dedupe uses meaningful feed content rather than moving API timestamps: item/quantity changes, current weather identity changes, and any sell-price change can post; restock/end-time drift alone cannot ping again.
- Expired, not-yet-started, and missing current weather entries are not announced. An inactive gap resets the current-weather key so a later genuine occurrence can post once.
- Best-effort role sync creates reusable item/event roles when a feed channel is configured.
