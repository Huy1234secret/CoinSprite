# GAG2 stock poster

Automatic Grow a Garden 2 stock feed.

- Posts to the per-guild channels configured in the dashboard `Gag2 stock` tab.
- Sends separate Discord Components V2 messages for seed, gear, crate, weather, moon prediction, and sell price changes.
- Uses `https://api.gag2.gg/api/live/stock`, `https://api.gag2.gg/api/live/weather`, and `https://api.gag2.gg/api/live/sell`.
- Runtime state is stored in ignored `data/gag2-stock-poster.json` to avoid reposting unchanged feed data after restart.
- Best-effort role sync creates reusable item/event roles when a feed channel is configured.
