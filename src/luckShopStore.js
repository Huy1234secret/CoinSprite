const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'luck-shop.json');
const CLOVER = '🍀';
const RESTOCK_INTERVAL_MS = 60 * 60 * 1000;

const LUCK_SHOP_ITEMS = [
  { id: 'luck_2', name: '×2 luck Rolls', multiplier: 2, minStock: 50, maxStock: 300, cost: 2, chance: 0.35 },
  { id: 'luck_10', name: '×10 luck Rolls', multiplier: 10, minStock: 10, maxStock: 200, cost: 5, chance: 0.25 },
  { id: 'luck_25', name: '×25 luck Rolls', multiplier: 25, minStock: 15, maxStock: 150, cost: 25, chance: 0.20 },
  { id: 'luck_50', name: '×50 luck Rolls', multiplier: 50, minStock: 10, maxStock: 100, cost: 50, chance: 0.13 },
  { id: 'luck_100', name: '×100 luck Rolls', multiplier: 100, minStock: 5, maxStock: 50, cost: 100, chance: 0.06 },
  { id: 'luck_1000', name: '×1000 luck Rolls', multiplier: 1000, minStock: 1, maxStock: 5, cost: 1000, chance: 0.01 },
];

function defaultState() {
  return { lastRestockHour: null, stock: {}, users: {} };
}

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(defaultState(), null, 2), 'utf8');
}

function normalizeItemStock(value) {
  const stock = Math.floor(Number(value) || 0);
  return Math.max(0, stock);
}

function normalizeUser(user) {
  const normalized = user && typeof user === 'object' ? user : {};
  normalized.cloverTokens = Math.max(0, Math.floor(Number(normalized.cloverTokens) || 0));
  normalized.inventory = normalized.inventory && typeof normalized.inventory === 'object' ? normalized.inventory : {};
  normalized.activeBoosts = Array.isArray(normalized.activeBoosts) ? normalized.activeBoosts : [];

  for (const item of LUCK_SHOP_ITEMS) {
    normalized.inventory[item.id] = Math.max(0, Math.floor(Number(normalized.inventory[item.id]) || 0));
  }

  normalized.activeBoosts = normalized.activeBoosts
    .map((boost) => ({
      id: String(boost?.id || ''),
      itemId: String(boost?.itemId || ''),
      name: String(boost?.name || ''),
      multiplier: Math.max(1, Number(boost?.multiplier) || 1),
      remainingRolls: Math.max(0, Math.floor(Number(boost?.remainingRolls) || 0)),
      usedAt: Number(boost?.usedAt) || Date.now(),
    }))
    .filter((boost) => boost.id && boost.remainingRolls > 0);

  return normalized;
}

function normalizeState(state) {
  const normalized = { ...defaultState(), ...(state && typeof state === 'object' ? state : {}) };
  normalized.stock = normalized.stock && typeof normalized.stock === 'object' ? normalized.stock : {};
  normalized.users = normalized.users && typeof normalized.users === 'object' ? normalized.users : {};
  normalized.lastRestockHour = normalized.lastRestockHour ? String(normalized.lastRestockHour) : null;

  for (const item of LUCK_SHOP_ITEMS) normalized.stock[item.id] = normalizeItemStock(normalized.stock[item.id]);
  for (const [userId, user] of Object.entries(normalized.users)) normalized.users[userId] = normalizeUser(user);
  return normalized;
}

function loadState() {
  ensureStore();
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')));
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8');
}

function hourKey(now = Date.now()) {
  return new Date(Math.floor(now / RESTOCK_INTERVAL_MS) * RESTOCK_INTERVAL_MS).toISOString();
}

function nextHourDate(now = new Date()) {
  const next = new Date(now.getTime());
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

function randomStock(item) {
  return item.minStock + Math.floor(Math.random() * ((item.maxStock - item.minStock) + 1));
}

function restockState(state, now = Date.now()) {
  const key = hourKey(now);
  if (state.lastRestockHour === key) return false;
  const stock = {};
  for (const item of LUCK_SHOP_ITEMS) stock[item.id] = Math.random() < item.chance ? randomStock(item) : 0;
  state.stock = stock;
  state.lastRestockHour = key;
  return true;
}

function ensureFreshShop(now = Date.now()) {
  const state = loadState();
  const changed = restockState(state, now);
  if (changed) saveState(state);
  return state;
}

function getShopSnapshot(now = Date.now()) {
  return ensureFreshShop(now);
}

function ensureUser(state, userId) {
  if (!state.users[userId]) state.users[userId] = normalizeUser({});
  state.users[userId] = normalizeUser(state.users[userId]);
  return state.users[userId];
}

function getUserSnapshot(userId) {
  const state = loadState();
  return ensureUser(state, userId);
}

function getCloverBalance(userId) {
  return getUserSnapshot(userId).cloverTokens;
}

function awardCloverTokens(userId, denominator) {
  const earned = Math.floor(Math.max(0, Number(denominator) || 0) / 100);
  if (earned <= 0) return { earned: 0, balance: getCloverBalance(userId) };
  const state = loadState();
  const user = ensureUser(state, userId);
  user.cloverTokens += earned;
  saveState(state);
  return { earned, balance: user.cloverTokens };
}

function buyItem(userId, itemId, quantity = 1, now = Date.now()) {
  const item = LUCK_SHOP_ITEMS.find((entry) => entry.id === itemId);
  const amount = Math.max(1, Math.floor(Number(quantity) || 1));
  if (!item) return { ok: false, reason: 'missing-item' };

  const state = ensureFreshShop(now);
  const user = ensureUser(state, userId);
  const stock = normalizeItemStock(state.stock[item.id]);
  const cost = item.cost * amount;
  if (stock < amount) return { ok: false, reason: 'stock', item, stock };
  if (user.cloverTokens < cost) return { ok: false, reason: 'tokens', item, cost, balance: user.cloverTokens };

  state.stock[item.id] = stock - amount;
  user.cloverTokens -= cost;
  user.inventory[item.id] = Math.max(0, Math.floor(Number(user.inventory[item.id]) || 0)) + amount;
  saveState(state);
  return { ok: true, item, quantity: amount, cost, balance: user.cloverTokens, remainingStock: state.stock[item.id] };
}

function activateInventoryBoost(userId, itemId, quantity) {
  const item = LUCK_SHOP_ITEMS.find((entry) => entry.id === itemId);
  const amount = Math.max(1, Math.floor(Number(quantity) || 0));
  if (!item) return { ok: false, reason: 'missing-item' };
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'amount' };

  const state = loadState();
  const user = ensureUser(state, userId);
  const owned = Math.max(0, Math.floor(Number(user.inventory[item.id]) || 0));
  if (owned < amount) return { ok: false, reason: 'inventory', item, owned };

  user.inventory[item.id] = owned - amount;
  const usedAt = Date.now();
  for (let i = 0; i < amount; i += 1) {
    user.activeBoosts.push({
      id: `${usedAt}-${item.id}-${Math.random().toString(36).slice(2, 8)}`,
      itemId: item.id,
      name: item.name,
      multiplier: item.multiplier,
      remainingRolls: 1,
      usedAt,
    });
  }
  saveState(state);
  return { ok: true, item, quantity: amount, activeMultiplier: item.multiplier * amount, remainingInventory: user.inventory[item.id] };
}

function getActiveUserBoosts(userId) {
  const state = loadState();
  const user = ensureUser(state, userId);
  return user.activeBoosts;
}

function getActiveUserBoostMultiplier(userId) {
  const boosts = getActiveUserBoosts(userId);
  if (boosts.length === 0) return 1;
  return boosts.reduce((total, boost) => total + Math.max(1, Number(boost.multiplier) || 1), 0);
}

function consumeActiveUserBoostRolls(userId) {
  const state = loadState();
  const user = ensureUser(state, userId);
  if (user.activeBoosts.length === 0) return [];
  const consumed = user.activeBoosts.map((boost) => ({ ...boost }));
  user.activeBoosts = user.activeBoosts
    .map((boost) => ({ ...boost, remainingRolls: boost.remainingRolls - 1 }))
    .filter((boost) => boost.remainingRolls > 0);
  saveState(state);
  return consumed;
}

module.exports = {
  CLOVER,
  LUCK_SHOP_ITEMS,
  RESTOCK_INTERVAL_MS,
  STORE_PATH,
  activateInventoryBoost,
  awardCloverTokens,
  buyItem,
  consumeActiveUserBoostRolls,
  ensureFreshShop,
  getActiveUserBoostMultiplier,
  getActiveUserBoosts,
  getCloverBalance,
  getShopSnapshot,
  getUserSnapshot,
  nextHourDate,
};
