# Grow a Garden 2 stock channel

CoinSprite can maintain an automatic stock channel without running a second Python bot.

## Setup

Run:

```text
/stock setup endpoint:https://provider.example/api/stock
```

Optional setup fields:

- `channel`: use an existing text or announcement channel. If omitted, CoinSprite creates `#grow-a-garden-2-stock` and needs **Manage Channels**.
- `interval`: provider check interval from 1 to 60 minutes. Default: 5.
- `mode`: edit one live message or post a new message whenever stock changes.
- `ping_role`: mention a role whenever the normalized stock changes.

Other commands:

- `/stock show`: show current provider stock in the current channel.
- `/stock refresh`: force an update in the configured stock channel.
- `/stock status`: show configuration and the last provider error.
- `/stock disable`: stop automatic checks.
- `!gagstock` or `!stock`: show current stock with a prefix command.

## Provider requirements

The endpoint must be a public HTTPS URL that returns JSON. CoinSprite rejects localhost, private IPs, redirects, responses over 1 MiB, requests over 12 seconds, and invalid JSON.

Supported category keys include:

```json
{
  "seed_stock": [{ "display_name": "Carrot", "quantity": 12 }],
  "gear_stock": [{ "display_name": "Watering Can", "quantity": 2 }],
  "egg_stock": [{ "display_name": "Common Egg", "quantity": 1 }]
}
```

It also accepts `seeds`, `gear`, `eggs`, `cosmetics`, `events`, `merchant`, nested `data` or `stock` objects, object maps, and custom categories under `categories`.

An optional provider key can be configured with:

```env
GROW_GARDEN_2_STOCK_API_KEY=your_provider_key
```

CoinSprite sends it as `Authorization: Bearer`, `x-api-key`, and `jstudio-key` for compatibility with common provider styles.

## Important

The example Python scraper using `https://example-gag-stock-website.com` cannot work: that domain is a placeholder and the sample HTML class names are guesses. Use a provider you trust and confirm that it permits automated API access.
