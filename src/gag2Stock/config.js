const path = require('path');

const POST_CHANNEL_ID = '1525184164930916433';
const STOCK_API_URL = 'https://api.gag2.gg/api/live/stock';
const COMPONENTS_V2_FLAG = 32768;
const GREEN = 0x57f287;
const RED = 0xed4245;
const CHECK_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const STATE_PATH = path.join(__dirname, '..', '..', 'data', 'gag2-stock-poster.json');

const CATEGORY_LABELS = {
  seed: 'Seeds',
  gear: 'Gear',
  crate: 'Crates',
};

const RARITY_RANK = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  mythic: 6,
  super: 7,
  divine: 8,
};

module.exports = {
  CATEGORY_LABELS,
  CHECK_INTERVAL_MS,
  COMPONENTS_V2_FLAG,
  GREEN,
  POST_CHANNEL_ID,
  RARITY_RANK,
  RED,
  REQUEST_TIMEOUT_MS,
  STATE_PATH,
  STOCK_API_URL,
};
