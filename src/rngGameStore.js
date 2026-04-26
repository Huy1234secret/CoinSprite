const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-game-balances.json');

const DEFAULT_UPGRADES = {
  luckLevel: 0,
  critChanceLevel: 0,
  critPowerLevel: 0,
  expLevel: 0,
};

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ balances: {}, upgrades: {} }, null, 2), 'utf8');
  }
}

function sanitizeUpgrades(upgrades) {
  const source = upgrades && typeof upgrades === 'object' ? upgrades : {};
  return {
    luckLevel: Math.max(0, Number(source.luckLevel) || 0),
    critChanceLevel: Math.max(0, Number(source.critChanceLevel) || 0),
    critPowerLevel: Math.max(0, Number(source.critPowerLevel) || 0),
    expLevel: Math.max(0, Number(source.expLevel) || 0),
  };
}

function normalizeState(state) {
  const next = state && typeof state === 'object' ? { ...state } : {};
  next.balances = next.balances && typeof next.balances === 'object' ? next.balances : {};
  next.upgrades = next.upgrades && typeof next.upgrades === 'object' ? next.upgrades : {};
  return next;
}

function loadState() {
  ensureStoreFile();

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return { balances: {}, upgrades: {} };
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

function addBalance(userId, amount) {
  const state = loadState();
  const current = Number(state.balances[userId] || 0);
  const next = current + amount;
  state.balances[userId] = next;
  saveState(state);
  return next;
}

function spendBalance(userId, amount) {
  const state = loadState();
  const current = Number(state.balances[userId] || 0);
  if (!Number.isFinite(amount) || amount <= 0 || current < amount) {
    return false;
  }
  state.balances[userId] = current - amount;
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

function getUpgradesReadonly(userId) {
  const state = loadState();
  return sanitizeUpgrades(state.upgrades[userId] || DEFAULT_UPGRADES);
}

function setUpgrades(userId, upgrades) {
  const state = loadState();
  state.upgrades[userId] = sanitizeUpgrades(upgrades);
  saveState(state);
  return state.upgrades[userId];
}

module.exports = {
  STORE_PATH,
  getBalance,
  addBalance,
  spendBalance,
  getUpgrades,
  getUpgradesReadonly,
  setUpgrades,
};
