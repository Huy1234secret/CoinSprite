const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-game-balances.json');

const DEFAULT_UPGRADES = {
  luckLevel: 0,
  critChanceLevel: 0,
  critPowerLevel: 0,
};

const DEFAULT_REBIRTH_UPGRADES = {
  glyphGrowth: 0,
  rarityJackpot: 0,
  luckDiscount: 0,
  fortuneCharge: 0,
  minefieldFortune: 0,
};

const DEFAULT_ROLL_STATS = {
  totalRolls: 0,
  fortuneReady: false,
};

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(getEmptyState(), null, 2), 'utf8');
  }
}

function getEmptyState() {
  return {
    balances: {},
    rebirthBalances: {},
    upgrades: {},
    rebirthUpgrades: {},
    rebirthTiers: {},
    discoveries: {},
    rollStats: {},
  };
}

function sanitizeUpgrades(upgrades) {
  const source = upgrades && typeof upgrades === 'object' ? upgrades : {};
  return {
    luckLevel: Math.max(0, Number(source.luckLevel) || 0),
    critChanceLevel: Math.max(0, Number(source.critChanceLevel) || 0),
    critPowerLevel: Math.max(0, Number(source.critPowerLevel) || 0),
  };
}

function sanitizeRebirthUpgrades(upgrades) {
  const source = upgrades && typeof upgrades === 'object' ? upgrades : {};
  return {
    glyphGrowth: Math.max(0, Number(source.glyphGrowth) || 0),
    rarityJackpot: Math.max(0, Number(source.rarityJackpot) || 0),
    luckDiscount: Math.max(0, Number(source.luckDiscount) || 0),
    fortuneCharge: Math.max(0, Number(source.fortuneCharge) || 0),
    minefieldFortune: Math.max(0, Number(source.minefieldFortune) || 0),
  };
}

function sanitizeRollStats(stats) {
  const source = stats && typeof stats === 'object' ? stats : {};
  return {
    totalRolls: Math.max(0, Number(source.totalRolls) || 0),
    fortuneReady: Boolean(source.fortuneReady),
  };
}

function normalizeState(state) {
  const next = state && typeof state === 'object' ? { ...state } : {};
  const empty = getEmptyState();

  for (const key of Object.keys(empty)) {
    next[key] = next[key] && typeof next[key] === 'object' ? next[key] : {};
  }

  return next;
}

function loadState() {
  ensureStoreFile();

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return getEmptyState();
  }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8');
}

function getBalance(userId) {
  const state = loadState();
  return Number(state.balances[userId] || 0);
}

function setBalance(userId, amount) {
  const state = loadState();
  state.balances[userId] = Math.max(0, Math.floor(Number(amount) || 0));
  saveState(state);
  return state.balances[userId];
}

function addBalance(userId, amount) {
  const state = loadState();
  const current = Number(state.balances[userId] || 0);
  const next = Math.max(0, Math.floor(current + amount));
  state.balances[userId] = next;
  saveState(state);
  return next;
}

function spendBalance(userId, amount) {
  const state = loadState();
  const spend = Math.floor(Number(amount) || 0);
  const current = Number(state.balances[userId] || 0);
  if (!Number.isFinite(spend) || spend <= 0 || current < spend) {
    return false;
  }
  state.balances[userId] = current - spend;
  saveState(state);
  return true;
}

function getRebirthBalance(userId) {
  const state = loadState();
  return Number(state.rebirthBalances[userId] || 0);
}

function addRebirthBalance(userId, amount) {
  const state = loadState();
  const current = Number(state.rebirthBalances[userId] || 0);
  const next = Math.max(0, Math.floor(current + amount));
  state.rebirthBalances[userId] = next;
  saveState(state);
  return next;
}

function spendRebirthBalance(userId, amount) {
  const state = loadState();
  const spend = Math.floor(Number(amount) || 0);
  const current = Number(state.rebirthBalances[userId] || 0);
  if (!Number.isFinite(spend) || spend <= 0 || current < spend) {
    return false;
  }
  state.rebirthBalances[userId] = current - spend;
  saveState(state);
  return true;
}

function getUpgrades(userId) {
  const state = loadState();
  const upgrades = sanitizeUpgrades(state.upgrades[userId] || DEFAULT_UPGRADES);
  state.upgrades[userId] = upgrades;
  saveState(state);
  return upgrades;
}

function setUpgrades(userId, upgrades) {
  const state = loadState();
  state.upgrades[userId] = sanitizeUpgrades(upgrades);
  saveState(state);
  return state.upgrades[userId];
}

function getRebirthUpgrades(userId) {
  const state = loadState();
  const upgrades = sanitizeRebirthUpgrades(state.rebirthUpgrades[userId] || DEFAULT_REBIRTH_UPGRADES);
  state.rebirthUpgrades[userId] = upgrades;
  saveState(state);
  return upgrades;
}

function setRebirthUpgrades(userId, upgrades) {
  const state = loadState();
  state.rebirthUpgrades[userId] = sanitizeRebirthUpgrades(upgrades);
  saveState(state);
  return state.rebirthUpgrades[userId];
}

function getRebirthTier(userId) {
  const state = loadState();
  return Math.max(0, Number(state.rebirthTiers[userId]) || 0);
}

function setRebirthTier(userId, tier) {
  const state = loadState();
  state.rebirthTiers[userId] = Math.max(0, Math.floor(Number(tier) || 0));
  saveState(state);
  return state.rebirthTiers[userId];
}

function getDiscoveredLetters(userId) {
  const state = loadState();
  const raw = state.discoveries[userId];
  const discoveries = Array.isArray(raw) ? raw.filter((value) => typeof value === 'string') : [];
  state.discoveries[userId] = [...new Set(discoveries)];
  saveState(state);
  return state.discoveries[userId];
}

function recordDiscoveredLetter(userId, letter) {
  const state = loadState();
  const current = Array.isArray(state.discoveries[userId]) ? state.discoveries[userId] : [];
  const unique = new Set(current.filter((value) => typeof value === 'string'));
  const wasNew = !unique.has(letter);
  unique.add(letter);
  state.discoveries[userId] = [...unique];
  saveState(state);
  return { discoveries: state.discoveries[userId], wasNew };
}

function hasDiscoveredLetter(userId, letter) {
  return getDiscoveredLetters(userId).includes(letter);
}

function getRollStats(userId) {
  const state = loadState();
  const stats = sanitizeRollStats(state.rollStats[userId] || DEFAULT_ROLL_STATS);
  state.rollStats[userId] = stats;
  saveState(state);
  return stats;
}

function setRollStats(userId, stats) {
  const state = loadState();
  state.rollStats[userId] = sanitizeRollStats(stats);
  saveState(state);
  return state.rollStats[userId];
}

function resetProgressForRebirth(userId) {
  const state = loadState();
  state.balances[userId] = 0;
  state.upgrades[userId] = { ...DEFAULT_UPGRADES };
  state.rollStats[userId] = { ...DEFAULT_ROLL_STATS };
  saveState(state);
}

function resetAllRngData() {
  const emptyState = getEmptyState();
  saveState(emptyState);
  return emptyState;
}

module.exports = {
  STORE_PATH,
  getBalance,
  setBalance,
  addBalance,
  spendBalance,
  getRebirthBalance,
  addRebirthBalance,
  spendRebirthBalance,
  getUpgrades,
  setUpgrades,
  getRebirthUpgrades,
  setRebirthUpgrades,
  getRebirthTier,
  setRebirthTier,
  getDiscoveredLetters,
  recordDiscoveredLetter,
  hasDiscoveredLetter,
  getRollStats,
  setRollStats,
  resetProgressForRebirth,
  resetAllRngData,
};
