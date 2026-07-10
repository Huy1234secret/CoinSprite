# GAG2 stock prediction poster

This folder contains the automatic Grow a Garden 2 stock prediction feed.

- Posts to channel `1525003375651848263`.
- Posts one Components V2 container message when the prediction window changes.
- Covers seed, gear, and crate predictions.
- Uses the public `GAG-2-Predictor` static `script.js` data source.
- Runtime state is stored in ignored `data/gag2-stock-poster.json` to avoid reposting the same window after restart.

This is a prediction feed only. If the public source data expires or becomes unavailable, the bot posts a warning instead of inventing live stock.
