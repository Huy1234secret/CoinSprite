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

const DATA_SOURCE_URLS = [
  'https://gag-2-predictor.vercel.app/script.js?v=2',
  'https://raw.githubusercontent.com/jcgaming-official/GAG-2-Predictor/main/script.js',
];

const CATEGORY_CONFIG = [
  { key: 'seeds', title: 'Seed', anchorKey: 'seedAnchor' },
  { key: 'gears', title: 'Gear', anchorKey: 'gearAnchor' },
  { key: 'crates', title: 'Crate', anchorKey: 'crateAnchor' },
];

module.exports = {
  CATEGORY_CONFIG,
  CHECK_INTERVAL_MS,
  COMPONENTS_V2_FLAG,
  DATA_SOURCE_URLS,
  GREEN,
  MAX_UPCOMING_ITEMS,
  POST_CHANNEL_ID,
  RED,
  REQUEST_TIMEOUT_MS,
  SOURCE_REFRESH_MS,
  STATE_PATH,
};
