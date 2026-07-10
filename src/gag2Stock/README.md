# GAG2 stock poster

This folder contains the automatic Grow a Garden 2 stock feed.

- Posts to channel `1525003375651848263`.
- Posts one Components V2 container message when the stock window changes.
- Covers seed, gear, and crate stock.
- Uses the public `https://www.game.guide/api/gag2-stock` JSON API.
- Uses browser-like request headers with fallback profiles because this third-party API can reject bot-looking traffic.
- Runtime state is stored in ignored `data/gag2-stock-poster.json` to avoid reposting the same window after restart.

If the public source becomes stale or unavailable, the bot posts a warning instead of inventing stock.
