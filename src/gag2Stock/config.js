const path = require('path');

const POST_CHANNEL_ID = '1525003375651848263';
const COMPONENTS_V2_FLAG = 32768;
const GREEN = 0x57f287;
const RED = 0xed4245;
const CHECK_INTERVAL_MS = 30_000;
const SOURCE_REFRESH_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_UPCOMING_ITEMS = 5;
const STATE_PATH = path.join(__dirname, '..', '..', 'data', 'gag2-stock-poster.json');

const STOCK_API_URLS = [
  'https://www.game.guide/api/gag2-stock',
];

const STOCK_API_HEADER_PROFILES = [
  {
    label: 'browser',
    headers: {
      accept: 'application/json,text/plain,*/*',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      origin: 'https://www.game.guide',
      pragma: 'no-cache',
      referer: 'https://www.game.guide/grow-a-garden-stock',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    },
  },
  {
    label: 'node-default',
    headers: {
      accept: 'application/json,text/plain,*/*',
    },
  },
  {
    label: 'coinsprite',
    headers: {
      accept: 'application/json',
      'user-agent': 'CoinSprite GAG2 stock poster',
    },
  },
];

const CATEGORY_CONFIG = [
  { key: 'seeds', title: 'Seed' },
  { key: 'gears', title: 'Gear' },
  { key: 'crates', title: 'Crate' },
];

module.exports = {
  CATEGORY_CONFIG,
  CHECK_INTERVAL_MS,
  COMPONENTS_V2_FLAG,
  GREEN,
  MAX_UPCOMING_ITEMS,
  POST_CHANNEL_ID,
  RED,
  REQUEST_TIMEOUT_MS,
  SOURCE_REFRESH_MS,
  STATE_PATH,
  STOCK_API_HEADER_PROFILES,
  STOCK_API_URLS,
};
