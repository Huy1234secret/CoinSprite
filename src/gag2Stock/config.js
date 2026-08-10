const path = require('path');

const STOCK_API_URL = 'https://gag.gg/api/seed-restock?world=main';
const FALL_STOCK_API_URL = 'https://gag.gg/api/seed-restock?world=fall';
const WEATHER_API_URL = 'https://api.gag2.gg/api/live/weather';
const SELL_API_URL = 'https://gag.gg/api/fruit-stock?world=main';
// Fall Harvest publishes stock and sell data from the same world feed.
const FALL_SELL_API_URL = 'https://gag.gg/api/fruit-stock?world=fall';
const COMPONENTS_V2_FLAG = 32768;
const GREEN = 0x57f287;
const FALL_ORANGE = 0xC96F2B;
const FALL_HARVEST_END_AT_MS = Date.parse('2026-10-01T07:00:00.000Z');
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CHECK_SCHEDULE_SECOND_MS = 1_000;
const CHECK_SCHEDULE_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEATHER_CHECK_INTERVAL_MS = 5_000;
const STOCK_FAILURE_RETRY_MS = 2_000;
// The upstream restock snapshot can take several seconds to roll over after a
// five-minute boundary. Keep retrying the boundary briefly instead of posting
// the previous cycle or giving up before the fresh snapshot arrives.
const STOCK_FAILURE_RETRY_LIMIT = 12;
const SELL_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const SELL_CHECK_SCHEDULE_SECOND_MS = 1_000;
// Sell retries stay short and bounded when a boundary returns an old or
// unavailable snapshot. Normal polls remain aligned to exact 10-minute marks.
const SELL_UNCHANGED_RETRY_MS = 2_000;
const SELL_FAILURE_RETRY_LIMIT = 3;
const REQUEST_TIMEOUT_MS = 5_000;
const REQUEST_RETRY_COUNT = 2;
const REQUEST_RETRY_DELAY_MS = 750;
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
  secret: 9,
};

function isFallHarvestActive(nowMs = Date.now()) {
  const now = Number(nowMs);
  return Number.isFinite(now) && now < FALL_HARVEST_END_AT_MS;
}

module.exports = {
  CATEGORY_LABELS,
  CHECK_INTERVAL_MS,
  CHECK_SCHEDULE_SECOND_MS,
  CHECK_SCHEDULE_UTC_OFFSET_MS,
  COMPONENTS_V2_FLAG,
  FALL_ORANGE,
  FALL_HARVEST_END_AT_MS,
  FALL_SELL_API_URL,
  FALL_STOCK_API_URL,
  GREEN,
  isFallHarvestActive,
  RARITY_RANK,
  REQUEST_RETRY_COUNT,
  REQUEST_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  SELL_API_URL,
  SELL_CHECK_INTERVAL_MS,
  SELL_CHECK_SCHEDULE_SECOND_MS,
  SELL_FAILURE_RETRY_LIMIT,
  SELL_UNCHANGED_RETRY_MS,
  STATE_PATH,
  STOCK_API_URL,
  STOCK_FAILURE_RETRY_LIMIT,
  STOCK_FAILURE_RETRY_MS,
  STOCK_TYPE_GROUPS,
  STOCK_TYPES,
  WEATHER_CHECK_INTERVAL_MS,
  WEATHER_API_URL,
};
