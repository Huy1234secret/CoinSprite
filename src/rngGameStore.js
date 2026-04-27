const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'rng-game-balances.json');

const DEFAULT_UPGRADES = { luckLevel: 0, critChanceLevel: 0, critPowerLevel: 0, expLevel: 0 };
const DEFAULT_REBIRTH_UPGRADES = { glyphGrowthLevel: 0, rarityJackpotLevel: 0, luckDiscountLevel: 0, fortuneChargeLevel: 0, minefieldFortuneLevel: 0 };
const DEFAULT_ROLL_STATS = { rollCount: 0, fortuneCharges: 0 };

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ balances: {}, upgrades: {}, rebirthCoins: {}, rebirths: {}, rebirthUpgrades: {}, discovered: {}, rollStats: {} }, null, 2), 'utf8');
  }
}
function sanitizeLevel(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
function sanitizeUpgrades(upgrades) { const s = upgrades && typeof upgrades === 'object' ? upgrades : {}; return { luckLevel: sanitizeLevel(s.luckLevel), critChanceLevel: sanitizeLevel(s.critChanceLevel), critPowerLevel: sanitizeLevel(s.critPowerLevel), expLevel: sanitizeLevel(s.expLevel) }; }
function sanitizeRebirthUpgrades(upgrades) { const s = upgrades && typeof upgrades === 'object' ? upgrades : {}; return { glyphGrowthLevel: sanitizeLevel(s.glyphGrowthLevel), rarityJackpotLevel: sanitizeLevel(s.rarityJackpotLevel), luckDiscountLevel: sanitizeLevel(s.luckDiscountLevel), fortuneChargeLevel: sanitizeLevel(s.fortuneChargeLevel), minefieldFortuneLevel: sanitizeLevel(s.minefieldFortuneLevel) }; }
function sanitizeRollStats(stats) { const s = stats && typeof stats === 'object' ? stats : {}; return { rollCount: sanitizeLevel(s.rollCount), fortuneCharges: sanitizeLevel(s.fortuneCharges) }; }
function normalizeState(state) { const n = state && typeof state === 'object' ? { ...state } : {}; n.balances = n.balances && typeof n.balances === 'object' ? n.balances : {}; n.upgrades = n.upgrades && typeof n.upgrades === 'object' ? n.upgrades : {}; n.rebirthCoins = n.rebirthCoins && typeof n.rebirthCoins === 'object' ? n.rebirthCoins : {}; n.rebirths = n.rebirths && typeof n.rebirths === 'object' ? n.rebirths : {}; n.rebirthUpgrades = n.rebirthUpgrades && typeof n.rebirthUpgrades === 'object' ? n.rebirthUpgrades : {}; n.discovered = n.discovered && typeof n.discovered === 'object' ? n.discovered : {}; n.rollStats = n.rollStats && typeof n.rollStats === 'object' ? n.rollStats : {}; return n; }
function loadState() { ensureStoreFile(); try { return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))); } catch { return normalizeState({}); } }
function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8'); }
function getBalance(userId) { const state = loadState(); return Number(state.balances[userId] || 0); }
function addBalance(userId, amount) { const state = loadState(); const next = Math.max(0, Number(state.balances[userId] || 0) + amount); state.balances[userId] = next; saveState(state); return next; }
function spendBalance(userId, amount) { const state = loadState(); const current = Number(state.balances[userId] || 0); if (!Number.isFinite(amount) || amount <= 0 || current < amount) return false; state.balances[userId] = current - amount; saveState(state); return true; }
function getRebirthCoins(userId) { const state = loadState(); return sanitizeLevel(state.rebirthCoins[userId]); }
function addRebirthCoins(userId, amount) { const state = loadState(); const next = Math.max(0, sanitizeLevel(state.rebirthCoins[userId]) + Math.floor(Number(amount) || 0)); state.rebirthCoins[userId] = next; saveState(state); return next; }
function spendRebirthCoins(userId, amount) { const state = loadState(); const current = sanitizeLevel(state.rebirthCoins[userId]); const cost = sanitizeLevel(amount); if (cost <= 0 || current < cost) return false; state.rebirthCoins[userId] = current - cost; saveState(state); return true; }
function getRebirthTier(userId) { const state = loadState(); return sanitizeLevel(state.rebirths[userId]); }
function setRebirthTier(userId, tier) { const state = loadState(); state.rebirths[userId] = sanitizeLevel(tier); saveState(state); return state.rebirths[userId]; }
function getUpgrades(userId) { const state = loadState(); const upgrades = sanitizeUpgrades(state.upgrades[userId] || DEFAULT_UPGRADES); state.upgrades[userId] = upgrades; saveState(state); return upgrades; }
function setUpgrades(userId, upgrades) { const state = loadState(); state.upgrades[userId] = sanitizeUpgrades(upgrades); saveState(state); return state.upgrades[userId]; }
function getRebirthUpgrades(userId) { const state = loadState(); const upgrades = sanitizeRebirthUpgrades(state.rebirthUpgrades[userId] || DEFAULT_REBIRTH_UPGRADES); state.rebirthUpgrades[userId] = upgrades; saveState(state); return upgrades; }
function setRebirthUpgrades(userId, upgrades) { const state = loadState(); state.rebirthUpgrades[userId] = sanitizeRebirthUpgrades(upgrades); saveState(state); return state.rebirthUpgrades[userId]; }
function getDiscoveredLetters(userId) { const state = loadState(); const discovered = Array.isArray(state.discovered[userId]) ? state.discovered[userId] : []; const unique = [...new Set(discovered.filter((letter) => typeof letter === 'string' && letter.length > 0))]; state.discovered[userId] = unique; saveState(state); return unique; }
function discoverLetter(userId, letter) { const state = loadState(); const discovered = Array.isArray(state.discovered[userId]) ? state.discovered[userId] : []; if (!discovered.includes(letter)) discovered.push(letter); state.discovered[userId] = discovered; saveState(state); return discovered; }
function hasDiscoveredLetter(userId, letter) { return getDiscoveredLetters(userId).includes(letter); }
function getRollStats(userId) { const state = loadState(); const stats = sanitizeRollStats(state.rollStats[userId] || DEFAULT_ROLL_STATS); state.rollStats[userId] = stats; saveState(state); return stats; }
function setRollStats(userId, stats) { const state = loadState(); state.rollStats[userId] = sanitizeRollStats(stats); saveState(state); return state.rollStats[userId]; }
function completeRebirth(userId, cost) { const state = loadState(); const currentBalance = Number(state.balances[userId] || 0); const rebirthCost = Math.max(0, Math.floor(Number(cost) || 0)); if (currentBalance < rebirthCost) return null; const nextTier = sanitizeLevel(state.rebirths[userId]) + 1; state.balances[userId] = currentBalance - rebirthCost; state.rebirths[userId] = nextTier; state.rebirthCoins[userId] = sanitizeLevel(state.rebirthCoins[userId]) + 1; saveState(state); return { rebirthTier: nextTier, rebirthCoins: state.rebirthCoins[userId], balance: state.balances[userId] }; }
function resetAllRngData() { const emptyState = normalizeState({}); saveState(emptyState); return emptyState; }
module.exports = { STORE_PATH, getBalance, addBalance, spendBalance, getRebirthCoins, addRebirthCoins, spendRebirthCoins, getRebirthTier, setRebirthTier, getUpgrades, setUpgrades, getRebirthUpgrades, setRebirthUpgrades, getDiscoveredLetters, discoverLetter, hasDiscoveredLetter, getRollStats, setRollStats, completeRebirth, resetAllRngData };
