const path = require('path');

const STOCK_API_URL = 'https://api.gag2.gg/api/live/stock';
const WEATHER_API_URL = 'https://api.gag2.gg/api/live/weather';
const SELL_API_URL = 'https://api.gag2.gg/api/live/sell';
const ITEMS_API_URL = 'https://api.gag2.gg/api/items';
const COMPONENTS_V2_FLAG = 32768;
const GREEN = 0x57f287;
const RED = 0xed4245;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CHECK_SCHEDULE_SECOND_MS = 5_000;
const CHECK_SCHEDULE_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const STALE_STOCK_RETRY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
const STATE_PATH = path.join(__dirname, '..', '..', 'data', 'gag2-stock-poster.json');

const CATEGORY_LABELS = {
  seed: 'Seed stock',
  gear: 'Gear',
  crate: 'Crate stock',
  weather: 'Weather',
  moon: 'Moon prediction',
  sell: 'Sell price track',
};

const STOCK_TYPES = ['seed', 'gear', 'crate', 'weather', 'moon', 'sell'];

const STOCK_TYPE_GROUPS = {
  stock: ['seed', 'gear', 'crate'],
  weather: ['weather', 'moon'],
  sell: ['sell'],
};

const RARITY_RANK = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  mythic: 6,
  mythical: 6,
  super: 7,
  divine: 8,
};

module.exports = {
  CATEGORY_LABELS,
  CHECK_INTERVAL_MS,
  CHECK_SCHEDULE_SECOND_MS,
  CHECK_SCHEDULE_UTC_OFFSET_MS,
  COMPONENTS_V2_FLAG,
  GREEN,
  ITEMS_API_URL,
  RARITY_RANK,
  RED,
  REQUEST_TIMEOUT_MS,
  SELL_API_URL,
  STATE_PATH,
  STALE_STOCK_RETRY_MS,
  STOCK_API_URL,
  STOCK_TYPE_GROUPS,
  STOCK_TYPES,
  WEATHER_API_URL,
};
