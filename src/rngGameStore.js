const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-game-balances.json');

const DEFAULT_UPGRADES = { luckLevel: 0, critChanceLevel: 0, critPowerLevel: 0, expLevel: 0 };
const DEFAULT_REBIRTH_UPGRADES = { glyphGrowthLevel: 0, rarityJackpotLevel: 0, luckDiscountLevel: 0, fortuneChargeLevel: 0, minefieldFortuneLevel: 0 };

function emptyState() {
  return { balances: {}, rebirthBalances: {}, upgrades: {}, rebirthUpgrades: {}, rebirths: {}, discoveries: {}, rollCounters: {}, fortuneCharges: {} };
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8');
}

function toLevel(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
function sanitizeUpgrades(source = {}) { return { luckLevel: toLevel(source.luckLevel), critChanceLevel: toLevel(source.critChanceLevel), critPowerLevel: toLevel(source.critPowerLevel), expLevel: toLevel(source.expLevel) }; }
function sanitizeRebirthUpgrades(source = {}) { return { glyphGrowthLevel: toLevel(source.glyphGrowthLevel), rarityJackpotLevel: toLevel(source.rarityJackpotLevel), luckDiscountLevel: toLevel(source.luckDiscountLevel), fortuneChargeLevel: toLevel(source.fortuneChargeLevel), minefieldFortuneLevel: toLevel(source.minefieldFortuneLevel) }; }
function sanitizeDiscoveries(value) { return Array.isArray(value) ? [...new Set(value.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean))] : []; }

function normalizeState(state) {
  const next = state && typeof state === 'object' ? { ...state } : emptyState();
  for (const key of Object.keys(emptyState())) next[key] = next[key] && typeof next[key] === 'object' ? next[key] : {};
  return next;
}

function loadState() {
  ensureStoreFile();
  try { return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))); } catch { return emptyState(); }
}

function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8'); }

function getBalance(userId) { return Number(loadState().balances[userId] || 0); }
function addBalance(userId, amount) { const state = loadState(); const next = Math.max(0, Number(state.balances[userId] || 0) + (Number(amount) || 0)); state.balances[userId] = next; saveState(state); return next; }
function spendBalance(userId, amount) { const state = loadState(); const current = Number(state.balances[userId] || 0); if (!Number.isFinite(amount) || amount <= 0 || current < amount) return false; state.balances[userId] = current - amount; saveState(state); return true; }

function getRebirthBalance(userId) { return Number(loadState().rebirthBalances[userId] || 0); }
function addRebirthBalance(userId, amount) { const state = loadState(); const next = Math.max(0, Number(state.rebirthBalances[userId] || 0) + (Number(amount) || 0)); state.rebirthBalances[userId] = next; saveState(state); return next; }
function spendRebirthBalance(userId, amount) { const state = loadState(); const current = Number(state.rebirthBalances[userId] || 0); if (!Number.isFinite(amount) || amount <= 0 || current < amount) return false; state.rebirthBalances[userId] = current - amount; saveState(state); return true; }

function getUpgrades(userId) { const state = loadState(); const upgrades = sanitizeUpgrades(state.upgrades[userId] || DEFAULT_UPGRADES); state.upgrades[userId] = upgrades; saveState(state); return upgrades; }
function setUpgrades(userId, upgrades) { const state = loadState(); state.upgrades[userId] = sanitizeUpgrades(upgrades); saveState(state); return state.upgrades[userId]; }
function getRebirthUpgrades(userId) { const state = loadState(); const upgrades = sanitizeRebirthUpgrades(state.rebirthUpgrades[userId] || DEFAULT_REBIRTH_UPGRADES); state.rebirthUpgrades[userId] = upgrades; saveState(state); return upgrades; }
function setRebirthUpgrades(userId, upgrades) { const state = loadState(); state.rebirthUpgrades[userId] = sanitizeRebirthUpgrades(upgrades); saveState(state); return state.rebirthUpgrades[userId]; }

function getRebirthTier(userId) { return toLevel(loadState().rebirths[userId]); }
function setRebirthTier(userId, tier) { const state = loadState(); state.rebirths[userId] = toLevel(tier); saveState(state); return state.rebirths[userId]; }
function getDiscoveredLetters(userId) { const state = loadState(); const discoveries = sanitizeDiscoveries(state.discoveries[userId]); state.discoveries[userId] = discoveries; saveState(state); return discoveries; }
function addDiscoveredLetter(userId, letter) { const state = loadState(); const discoveries = sanitizeDiscoveries(state.discoveries[userId]); const value = String(letter || '').trim().toUpperCase(); if (value && !discoveries.includes(value)) discoveries.push(value); state.discoveries[userId] = discoveries; saveState(state); return discoveries; }
function incrementRollCounter(userId) { const state = loadState(); const next = toLevel(state.rollCounters[userId]) + 1; state.rollCounters[userId] = next; saveState(state); return next; }
function consumeFortuneCharge(userId) { const state = loadState(); const active = Boolean(state.fortuneCharges[userId]); state.fortuneCharges[userId] = false; saveState(state); return active; }
function setFortuneCharge(userId, value) { const state = loadState(); state.fortuneCharges[userId] = Boolean(value); saveState(state); return state.fortuneCharges[userId]; }
function resetAllRngData() { const state = emptyState(); saveState(state); return state; }

module.exports = { STORE_PATH, getBalance, addBalance, spendBalance, getRebirthBalance, addRebirthBalance, spendRebirthBalance, getUpgrades, setUpgrades, getRebirthUpgrades, setRebirthUpgrades, getRebirthTier, setRebirthTier, getDiscoveredLetters, addDiscoveredLetter, incrementRollCounter, consumeFortuneCharge, setFortuneCharge, resetAllRngData };
