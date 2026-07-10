# GAG2 stock poster

Automatic Grow a Garden 2 stock feed.

- Posts to channel `1525184164930916433`.
- Uses `https://api.gag2.gg/api/live/stock`.
- Posts a Discord Components V2 container when stock changes.
- Covers seeds, gear, and crates from the API payload.
- Runtime state is stored in ignored `data/gag2-stock-poster.json` to avoid reposting the same stock after restart.
