const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'economy-v2.json');

function getEmptyState() {
  return {
    coins: {},
    skillPoints: {},
    stats: {},
    achievements: {},
    workCooldowns: {},
    lastBetInputs: {},
    incomeClaims: {},
  };
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(getEmptyState(), null, 2), 'utf8');
}

function normalizeState(state) {
  const next = state && typeof state === 'object' ? { ...state } : {};
  const empty = getEmptyState();
  for (const key of Object.keys(empty)) next[key] = next[key] && typeof next[key] === 'object' ? next[key] : {};
  return next;
}
function loadState() { ensureStoreFile(); try { return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))); } catch { return getEmptyState(); } }
function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8'); }

function getBalance(userId) { return Number(loadState().coins[userId] || 0); }
function setBalance(userId, amount) { const state = loadState(); state.coins[userId] = Math.max(0, Math.floor(Number(amount) || 0)); saveState(state); return state.coins[userId]; }
function addBalance(userId, amount) { const state = loadState(); const next = Math.max(0, Math.floor(Number(state.coins[userId] || 0) + amount)); state.coins[userId] = next; saveState(state); return next; }
function spendBalance(userId, amount) { const state = loadState(); const spend = Math.floor(Number(amount) || 0); const current = Number(state.coins[userId] || 0); if (!Number.isFinite(spend) || spend <= 0 || current < spend) return false; state.coins[userId] = current - spend; saveState(state); return true; }

function getSkillPoints(userId) { return Number(loadState().skillPoints[userId] || 0); }
function setSkillPoints(userId, amount) { const state = loadState(); state.skillPoints[userId] = Math.max(0, Math.floor(Number(amount) || 0)); saveState(state); return state.skillPoints[userId]; }
function addSkillPoints(userId, amount) { const state = loadState(); const next = Math.max(0, Math.floor(Number(state.skillPoints[userId] || 0) + amount)); state.skillPoints[userId] = next; saveState(state); return next; }
function spendSkillPoints(userId, amount) { const state = loadState(); const spend = Math.floor(Number(amount) || 0); const current = Number(state.skillPoints[userId] || 0); if (!Number.isFinite(spend) || spend <= 0 || current < spend) return false; state.skillPoints[userId] = current - spend; saveState(state); return true; }

// Backward-compatible names for old imports. The old second currency now maps to skill points.
function getJackpotBalance(userId) { return getSkillPoints(userId); }
function addJackpotBalance(userId, amount) { return addSkillPoints(userId, amount); }
function spendJackpotBalance(userId, amount) { return spendSkillPoints(userId, amount); }
function resetAllGamblingData() { const emptyState = getEmptyState(); saveState(emptyState); return emptyState; }

function getDefaultUserStats() {
  return {
    moneyEarned: 0,
    triviaCorrectTotal: 0,
    triviaBestRun: { all: 0, easy: 0, medium: 0, hard: 0 },
    minefieldCompleted: { all: 0, easy: 0, medium: 0, hard: 0, hardcore: 0 },
    rouletteStraightWins: { straight: 0 },
  };
}
function getDefaultAchievementRecord() { return { unlockedAt: null }; }
function getUserAchievementsRecord(state, userId) { if (!state.achievements[userId] || typeof state.achievements[userId] !== 'object') state.achievements[userId] = {}; return state.achievements[userId]; }
function getUserStatsRecord(state, userId) {
  if (!state.stats[userId] || typeof state.stats[userId] !== 'object') state.stats[userId] = getDefaultUserStats();
  const base = getDefaultUserStats();
  const current = state.stats[userId];
  state.stats[userId] = { ...base, ...current, triviaBestRun: { ...base.triviaBestRun, ...(current.triviaBestRun || {}) }, minefieldCompleted: { ...base.minefieldCompleted, ...(current.minefieldCompleted || {}) }, rouletteStraightWins: { ...base.rouletteStraightWins, ...(current.rouletteStraightWins || {}) } };
  return state.stats[userId];
}

function recordGamblingEarnings(userId, amount) { const delta = Math.max(0, Math.floor(Number(amount) || 0)); if (delta <= 0) return 0; const state = loadState(); const stats = getUserStatsRecord(state, userId); stats.moneyEarned += delta; saveState(state); return stats.moneyEarned; }
function recordRouletteStraightWin(userId, amount = 1) { const delta = Math.max(0, Math.floor(Number(amount) || 0)); if (delta <= 0) return 0; const state = loadState(); const stats = getUserStatsRecord(state, userId); stats.rouletteStraightWins.straight += delta; saveState(state); return stats.rouletteStraightWins.straight; }
function recordTriviaRun(userId, perDifficultyCorrect = {}, isRandomRun = false) { const easy = Math.max(0, Math.floor(Number(perDifficultyCorrect.easy) || 0)); const medium = Math.max(0, Math.floor(Number(perDifficultyCorrect.medium) || 0)); const hard = Math.max(0, Math.floor(Number(perDifficultyCorrect.hard) || 0)); const all = isRandomRun ? (easy + medium + hard) : 0; const state = loadState(); const stats = getUserStatsRecord(state, userId); stats.triviaCorrectTotal += all; stats.triviaBestRun.easy = Math.max(stats.triviaBestRun.easy, easy); stats.triviaBestRun.medium = Math.max(stats.triviaBestRun.medium, medium); stats.triviaBestRun.hard = Math.max(stats.triviaBestRun.hard, hard); stats.triviaBestRun.all = Math.max(stats.triviaBestRun.all, all); saveState(state); return stats.triviaBestRun; }
function getTriviaXpMultiplier(userId) { const state = loadState(); const stats = getUserStatsRecord(state, userId); return Number((1.1 ** Math.floor(Math.max(0, Math.floor(Number(stats.triviaCorrectTotal) || 0)) / 50)).toFixed(6)); }
function incrementMinefieldCompleted(userId, difficulty) { const safeDifficulty = ['easy', 'medium', 'hard', 'hardcore'].includes(difficulty) ? difficulty : null; if (!safeDifficulty) return null; const state = loadState(); const stats = getUserStatsRecord(state, userId); stats.minefieldCompleted[safeDifficulty] += 1; stats.minefieldCompleted.all += 1; saveState(state); return stats.minefieldCompleted; }
function getGamblingStats(userId) { const state = loadState(); return JSON.parse(JSON.stringify(getUserStatsRecord(state, userId))); }
function getAllGamblingStats() { const state = loadState(); const result = {}; for (const userId of Object.keys(state.stats || {})) result[userId] = getUserStatsRecord(state, userId); return JSON.parse(JSON.stringify(result)); }
function getAllBalances() { return JSON.parse(JSON.stringify(loadState().coins || {})); }
function unlockAchievement(userId, achievementId) { const id = String(achievementId || '').trim(); if (!id) return false; const state = loadState(); const userAchievements = getUserAchievementsRecord(state, userId); if (userAchievements[id]?.unlockedAt) return false; userAchievements[id] = { ...getDefaultAchievementRecord(), unlockedAt: Date.now() }; saveState(state); return true; }
function hasAchievement(userId, achievementId) { const id = String(achievementId || '').trim(); if (!id) return false; const state = loadState(); return Boolean(getUserAchievementsRecord(state, userId)[id]?.unlockedAt); }
function getUserAchievements(userId) { const state = loadState(); return JSON.parse(JSON.stringify(getUserAchievementsRecord(state, userId))); }
function getWorkCooldown(userId) { return Number(loadState().workCooldowns[userId] || 0); }
function setWorkCooldown(userId, nextAvailableAt) { const state = loadState(); state.workCooldowns[userId] = Math.max(0, Math.floor(Number(nextAvailableAt) || 0)); saveState(state); return state.workCooldowns[userId]; }
function getLastBetInput(userId, gameKey = 'default') { const state = loadState(); const key = String(gameKey || 'default').trim().toLowerCase() || 'default'; const userInputs = state.lastBetInputs[userId] && typeof state.lastBetInputs[userId] === 'object' ? state.lastBetInputs[userId] : {}; return typeof userInputs[key] === 'string' ? userInputs[key] : ''; }
function setLastBetInput(userId, value, gameKey = 'default') { const state = loadState(); const key = String(gameKey || 'default').trim().toLowerCase() || 'default'; const inputValue = String(value || '').trim(); if (!state.lastBetInputs[userId] || typeof state.lastBetInputs[userId] !== 'object') state.lastBetInputs[userId] = {}; if (inputValue) state.lastBetInputs[userId][key] = inputValue; else delete state.lastBetInputs[userId][key]; saveState(state); return state.lastBetInputs[userId][key] || ''; }
function getIncomeClaim(userId) { const state = loadState(); const stored = state.incomeClaims[userId]; const entry = stored && typeof stored === 'object' ? stored : {}; return { startedAt: Math.max(0, Math.floor(Number(entry.startedAt) || 0)), lastClaimAt: Math.max(0, Math.floor(Number(entry.lastClaimAt) || 0)) }; }
function setIncomeClaim(userId, values = {}) { const state = loadState(); if (!state.incomeClaims[userId] || typeof state.incomeClaims[userId] !== 'object') state.incomeClaims[userId] = {}; if (values.startedAt !== undefined) state.incomeClaims[userId].startedAt = Math.max(0, Math.floor(Number(values.startedAt) || 0)); if (values.lastClaimAt !== undefined) state.incomeClaims[userId].lastClaimAt = Math.max(0, Math.floor(Number(values.lastClaimAt) || 0)); saveState(state); return getIncomeClaim(userId); }

module.exports = { STORE_PATH, getBalance, setBalance, addBalance, spendBalance, getSkillPoints, setSkillPoints, addSkillPoints, spendSkillPoints, getJackpotBalance, addJackpotBalance, spendJackpotBalance, resetAllGamblingData, recordGamblingEarnings, recordRouletteStraightWin, recordTriviaRun, getTriviaXpMultiplier, incrementMinefieldCompleted, getGamblingStats, getAllGamblingStats, getAllBalances, unlockAchievement, hasAchievement, getUserAchievements, getWorkCooldown, setWorkCooldown, getLastBetInput, setLastBetInput, getIncomeClaim, setIncomeClaim };
