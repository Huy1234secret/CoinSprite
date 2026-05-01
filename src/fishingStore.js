const fs = require('fs');
const path = require('path');
const {
  FISHING_ROD_ID,
  WORM_ID,
  BUCKET_OF_WORMS_ID,
  ITEMS,
  FISHES,
  ITEM_BY_ID,
  FISHING_UPGRADES,
  SHOP_TYPES,
  getMaxRodDurability,
  getCollectableBaseValue,
  randomInt,
  getNextHourlyBoundaryUtcPlus7,
} = require('./fishingConfig');

const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-economy.json');
const HOUR_MS = 60 * 60 * 1000;
const MARKET_HISTORY_LIMIT = 168;

function getEmptyState() {
  return {
    users: {},
    shop: {
      stockHour: null,
      stock: {},
    },
    market: {
      lastUpdateHour: null,
      items: {},
    },
  };
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(getEmptyState(), null, 2), 'utf8');
  }
}

function normalizeUser(user) {
  const record = user && typeof user === 'object' ? { ...user } : {};
  record.inventory = record.inventory && typeof record.inventory === 'object' ? record.inventory : {};
  record.gear = record.gear && typeof record.gear === 'object' ? record.gear : {};
  record.fishingUpgrades = record.fishingUpgrades && typeof record.fishingUpgrades === 'object' ? record.fishingUpgrades : {};
  for (const key of Object.keys(FISHING_UPGRADES)) {
    record.fishingUpgrades[key] = Math.max(0, Math.floor(Number(record.fishingUpgrades[key]) || 0));
  }
  for (const itemId of Object.keys(record.inventory)) {
    const amount = Math.max(0, Math.floor(Number(record.inventory[itemId]) || 0));
    if (amount > 0) record.inventory[itemId] = amount;
    else delete record.inventory[itemId];
  }
  return record;
}

function normalizeMarketItem(itemId, entry) {
  const baseBuy = getMarketBaseBuyPrice(itemId);
  const buyPrice = Math.max(Math.floor(baseBuy * 0.25), Math.round(Number(entry?.buyPrice) || baseBuy));
  const sellPrice = Math.min(buyPrice - 1, Math.max(1, Math.round(Number(entry?.sellPrice) || getDefaultSellPrice(buyPrice))));
  const history = Array.isArray(entry?.history) ? entry.history.slice(-MARKET_HISTORY_LIMIT) : [];
  if (!history.length) history.push({ t: Date.now(), buy: buyPrice, sell: sellPrice });
  return {
    buyPrice,
    sellPrice,
    buyVolume: Math.max(0, Math.floor(Number(entry?.buyVolume) || 0)),
    sellVolume: Math.max(0, Math.floor(Number(entry?.sellVolume) || 0)),
    history,
  };
}

function normalizeState(state) {
  const empty = getEmptyState();
  const next = state && typeof state === 'object' ? { ...state } : empty;
  next.users = next.users && typeof next.users === 'object' ? next.users : {};
  next.shop = next.shop && typeof next.shop === 'object' ? next.shop : empty.shop;
  next.shop.stock = next.shop.stock && typeof next.shop.stock === 'object' ? next.shop.stock : {};
  next.market = next.market && typeof next.market === 'object' ? next.market : empty.market;
  next.market.items = next.market.items && typeof next.market.items === 'object' ? next.market.items : {};

  for (const userId of Object.keys(next.users)) {
    next.users[userId] = normalizeUser(next.users[userId]);
  }
  for (const itemId of [...ITEMS.map((item) => item.id), ...FISHES.map((fish) => fish.id)]) {
    next.market.items[itemId] = normalizeMarketItem(itemId, next.market.items[itemId]);
  }
  return next;
}

function loadState() {
  ensureStoreFile();
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
  } catch {
    return getEmptyState();
  }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8');
}

function mutateState(mutator) {
  const state = loadState();
  const result = mutator(state);
  saveState(state);
  return result;
}

function getUserRecord(state, userId) {
  const id = String(userId);
  if (!state.users[id]) state.users[id] = normalizeUser({});
  state.users[id] = normalizeUser(state.users[id]);
  return state.users[id];
}

function getInventory(userId) {
  const state = loadState();
  return JSON.parse(JSON.stringify(getUserRecord(state, userId).inventory));
}

function getInventoryAmount(userId, itemId) {
  const state = loadState();
  return Math.max(0, Math.floor(Number(getUserRecord(state, userId).inventory[itemId]) || 0));
}

function addInventoryItem(userId, itemId, amount = 1) {
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (delta <= 0 || !ITEM_BY_ID[itemId]) return 0;
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    user.inventory[itemId] = Math.max(0, Math.floor(Number(user.inventory[itemId]) || 0)) + delta;
    return user.inventory[itemId];
  });
}

function removeInventoryItem(userId, itemId, amount = 1) {
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (delta <= 0) return false;
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    const current = Math.max(0, Math.floor(Number(user.inventory[itemId]) || 0));
    if (current < delta) return false;
    const next = current - delta;
    if (next > 0) user.inventory[itemId] = next;
    else delete user.inventory[itemId];
    return true;
  });
}

function getFishingUpgrades(userId) {
  const state = loadState();
  return JSON.parse(JSON.stringify(getUserRecord(state, userId).fishingUpgrades));
}

function increaseFishingUpgrade(userId, key) {
  if (!FISHING_UPGRADES[key]) return null;
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    const current = Math.max(0, Math.floor(Number(user.fishingUpgrades[key]) || 0));
    if (current >= FISHING_UPGRADES[key].maxTier) return null;
    user.fishingUpgrades[key] = current + 1;
    return user.fishingUpgrades[key];
  });
}

function getEquippedRod(userId) {
  const state = loadState();
  const rod = getUserRecord(state, userId).gear?.[FISHING_ROD_ID];
  if (!rod || Math.floor(Number(rod.durability) || 0) <= 0) return null;
  return JSON.parse(JSON.stringify(rod));
}

function equipNextFishingRod(userId) {
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    const upgrades = user.fishingUpgrades;
    const current = user.gear[FISHING_ROD_ID];
    if (current && Math.floor(Number(current.durability) || 0) > 0) return current;
    const stock = Math.max(0, Math.floor(Number(user.inventory[FISHING_ROD_ID]) || 0));
    if (stock <= 0) {
      delete user.gear[FISHING_ROD_ID];
      return null;
    }
    user.inventory[FISHING_ROD_ID] = stock - 1;
    if (user.inventory[FISHING_ROD_ID] <= 0) delete user.inventory[FISHING_ROD_ID];
    user.gear[FISHING_ROD_ID] = {
      itemId: FISHING_ROD_ID,
      durability: getMaxRodDurability(upgrades.durability),
      maxDurability: getMaxRodDurability(upgrades.durability),
      equippedAt: Date.now(),
    };
    return user.gear[FISHING_ROD_ID];
  });
}

function destroyEquippedRod(userId) {
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    const hadRod = Boolean(user.gear[FISHING_ROD_ID]);
    delete user.gear[FISHING_ROD_ID];
    const stock = Math.max(0, Math.floor(Number(user.inventory[FISHING_ROD_ID]) || 0));
    if (stock <= 0) return { destroyed: hadRod, equipped: null };
    user.inventory[FISHING_ROD_ID] = stock - 1;
    if (user.inventory[FISHING_ROD_ID] <= 0) delete user.inventory[FISHING_ROD_ID];
    const maxDurability = getMaxRodDurability(user.fishingUpgrades.durability);
    user.gear[FISHING_ROD_ID] = {
      itemId: FISHING_ROD_ID,
      durability: maxDurability,
      maxDurability,
      equippedAt: Date.now(),
    };
    return { destroyed: hadRod, equipped: user.gear[FISHING_ROD_ID] };
  });
}

function damageEquippedRod(userId, amount) {
  const damage = Math.max(0, Number(amount) || 0);
  if (damage <= 0) return { broke: false, rod: getEquippedRod(userId) };
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    const rod = user.gear[FISHING_ROD_ID];
    if (!rod) return { broke: true, rod: null };
    rod.durability = Math.max(0, Number(rod.durability) - damage);
    if (rod.durability > 0) return { broke: false, rod };
    delete user.gear[FISHING_ROD_ID];

    const stock = Math.max(0, Math.floor(Number(user.inventory[FISHING_ROD_ID]) || 0));
    if (stock > 0) {
      user.inventory[FISHING_ROD_ID] = stock - 1;
      if (user.inventory[FISHING_ROD_ID] <= 0) delete user.inventory[FISHING_ROD_ID];
      const maxDurability = getMaxRodDurability(user.fishingUpgrades.durability);
      user.gear[FISHING_ROD_ID] = {
        itemId: FISHING_ROD_ID,
        durability: maxDurability,
        maxDurability,
        equippedAt: Date.now(),
      };
      return { broke: true, rod: user.gear[FISHING_ROD_ID] };
    }

    return { broke: true, rod: null };
  });
}

function hasFishingRequirements(userId) {
  const state = loadState();
  const user = getUserRecord(state, userId);
  const hasRod = Boolean(user.gear[FISHING_ROD_ID]?.durability > 0) || Math.max(0, Number(user.inventory[FISHING_ROD_ID]) || 0) > 0;
  const hasWorm = Math.max(0, Number(user.inventory[WORM_ID]) || 0) > 0;
  const missing = [];
  if (!hasRod) missing.push('Fishing rod');
  if (!hasWorm) missing.push('Worm');
  return { ready: hasRod && hasWorm, hasRod, hasWorm, missing };
}

function useBucketOfWorms(userId, amount = 1) {
  const count = Math.max(1, Math.floor(Number(amount) || 1));
  const owned = getInventoryAmount(userId, BUCKET_OF_WORMS_ID);
  if (owned < count) return { ok: false, gained: 0, used: 0, missing: count - owned };
  let gained = 0;
  for (let i = 0; i < count; i += 1) gained += randomInt(3, 10);
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    user.inventory[BUCKET_OF_WORMS_ID] -= count;
    if (user.inventory[BUCKET_OF_WORMS_ID] <= 0) delete user.inventory[BUCKET_OF_WORMS_ID];
    user.inventory[WORM_ID] = Math.max(0, Number(user.inventory[WORM_ID]) || 0) + gained;
    return { ok: true, gained, used: count };
  });
}

function getCurrentShopHour(now = new Date()) {
  const shifted = new Date(now.getTime() + (7 * HOUR_MS));
  shifted.setUTCMinutes(0, 0, 0);
  return shifted.toISOString();
}

function generateShopStock() {
  const stock = {};
  for (const shopKey of Object.keys(SHOP_TYPES)) stock[shopKey] = {};
  for (const item of ITEMS) {
    if (!item.shop || item.stockMin == null || item.stockMax == null) continue;
    stock[item.shop][item.id] = randomInt(item.stockMin, item.stockMax);
  }
  return stock;
}

function refreshShopStockIfNeeded(state) {
  const currentHour = getCurrentShopHour();
  if (state.shop.stockHour !== currentHour) {
    state.shop.stockHour = currentHour;
    state.shop.stock = generateShopStock();
  }
}

function getShopState() {
  const state = loadState();
  refreshShopStockIfNeeded(state);
  saveState(state);
  return JSON.parse(JSON.stringify(state.shop));
}

function decrementShopStock(shopKey, itemId, amount) {
  const count = Math.max(1, Math.floor(Number(amount) || 1));
  return mutateState((state) => {
    refreshShopStockIfNeeded(state);
    const stock = Math.max(0, Math.floor(Number(state.shop.stock?.[shopKey]?.[itemId]) || 0));
    if (stock < count) return false;
    state.shop.stock[shopKey][itemId] = stock - count;
    return true;
  });
}

function getMarketBaseBuyPrice(itemId) {
  const item = ITEM_BY_ID[itemId];
  if (!item) return 1;
  if (Number.isFinite(item.price) && item.price > 0) return Math.max(1, Math.round(item.price));
  return Math.max(1, Math.round(Number(item.baseValue) || getCollectableBaseValue(itemId) || 1));
}

function getDefaultSellPrice(buyPrice) {
  return Math.max(1, Math.floor((Number(buyPrice) || 1) * 0.70));
}

function getMarketFloor(itemId) {
  return Math.max(1, Math.floor(getMarketBaseBuyPrice(itemId) * 0.35));
}

function getMarketSoftCap(itemId) {
  return Math.max(2, Math.floor(getMarketBaseBuyPrice(itemId) * 6));
}

function getMarketItem(state, itemId) {
  if (!state.market.items[itemId]) state.market.items[itemId] = normalizeMarketItem(itemId, null);
  state.market.items[itemId] = normalizeMarketItem(itemId, state.market.items[itemId]);
  return state.market.items[itemId];
}

function applyMarketHourlyUpdate(state) {
  const currentHour = getCurrentShopHour();
  if (state.market.lastUpdateHour === currentHour) return false;

  for (const itemId of Object.keys(ITEM_BY_ID)) {
    const marketItem = getMarketItem(state, itemId);
    const base = getMarketBaseBuyPrice(itemId);
    const floor = getMarketFloor(itemId);
    const softCap = getMarketSoftCap(itemId);
    const buyVolume = Math.max(0, marketItem.buyVolume);
    const sellVolume = Math.max(0, marketItem.sellVolume);
    const pressure = buyVolume - (sellVolume * 1.2);
    const softCapDrag = marketItem.buyPrice > softCap
      ? 1 / (1 + ((marketItem.buyPrice - softCap) / softCap))
      : 1;
    const demandMove = base * 0.018 * pressure * softCapDrag;
    const recoveryMove = (base - marketItem.buyPrice) * 0.08;
    const nextBuy = Math.max(floor, Math.round(marketItem.buyPrice + demandMove + recoveryMove));
    const spread = 0.18 + Math.min(0.20, sellVolume * 0.015);
    const nextSell = Math.max(1, Math.min(nextBuy - 1, Math.round(nextBuy * (1 - spread))));

    marketItem.buyPrice = nextBuy;
    marketItem.sellPrice = nextSell;
    marketItem.buyVolume = 0;
    marketItem.sellVolume = 0;
    marketItem.history.push({ t: Date.now(), buy: nextBuy, sell: nextSell });
    marketItem.history = marketItem.history.slice(-MARKET_HISTORY_LIMIT);
  }
  state.market.lastUpdateHour = currentHour;
  return true;
}

function updateMarket() {
  return mutateState((state) => applyMarketHourlyUpdate(state));
}

function getMarketSnapshot(itemId = null) {
  const state = loadState();
  applyMarketHourlyUpdate(state);
  saveState(state);
  if (itemId) return JSON.parse(JSON.stringify(getMarketItem(state, itemId)));
  return JSON.parse(JSON.stringify(state.market));
}

function recordMarketBuy(itemId, amount = 1) {
  const count = Math.max(1, Math.floor(Number(amount) || 1));
  return mutateState((state) => {
    const marketItem = getMarketItem(state, itemId);
    marketItem.buyVolume += count;
    return marketItem.buyVolume;
  });
}

function recordMarketSell(itemId, amount = 1) {
  const count = Math.max(1, Math.floor(Number(amount) || 1));
  return mutateState((state) => {
    const marketItem = getMarketItem(state, itemId);
    marketItem.sellVolume += count;
    return marketItem.sellVolume;
  });
}

function getInventoryEntries(userId, options = {}) {
  const inventory = getInventory(userId);
  const includeZero = Boolean(options.includeZero);
  const ids = includeZero ? Object.keys(ITEM_BY_ID) : Object.keys(inventory);
  return ids
    .map((itemId) => ({ item: ITEM_BY_ID[itemId], amount: Math.max(0, Math.floor(Number(inventory[itemId]) || 0)) }))
    .filter((entry) => entry.item && (includeZero || entry.amount > 0));
}

module.exports = {
  STORE_PATH,
  getInventory,
  getInventoryAmount,
  getInventoryEntries,
  addInventoryItem,
  removeInventoryItem,
  getFishingUpgrades,
  increaseFishingUpgrade,
  getEquippedRod,
  equipNextFishingRod,
  destroyEquippedRod,
  damageEquippedRod,
  hasFishingRequirements,
  useBucketOfWorms,
  getShopState,
  decrementShopStock,
  getMarketBaseBuyPrice,
  getMarketSnapshot,
  updateMarket,
  recordMarketBuy,
  recordMarketSell,
};
