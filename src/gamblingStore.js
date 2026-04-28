const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'gambling-balances.json');
const LEGACY_STORE_PATH = path.join(__dirname, '..', 'data', 'rng-game-balances.json');

function getEmptyState() {
  return {
    balances: {},
    jackpotBalances: {},
    stats: {},
  };
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    if (fs.existsSync(LEGACY_STORE_PATH)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(LEGACY_STORE_PATH, 'utf8'));
        const migrated = {
          balances: legacy.balances && typeof legacy.balances === 'object' ? legacy.balances : {},
          jackpotBalances: legacy.rebirthBalances && typeof legacy.rebirthBalances === 'object' ? legacy.rebirthBalances : {},
        };
        fs.writeFileSync(STORE_PATH, JSON.stringify(migrated, null, 2), 'utf8');
        return;
      } catch {
        // Fall through and create a clean gambling store.
      }
    }

    fs.writeFileSync(STORE_PATH, JSON.stringify(getEmptyState(), null, 2), 'utf8');
  }
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

function getJackpotBalance(userId) {
  const state = loadState();
  return Number(state.jackpotBalances[userId] || 0);
}

function addJackpotBalance(userId, amount) {
  const state = loadState();
  const current = Number(state.jackpotBalances[userId] || 0);
  const next = Math.max(0, Math.floor(current + amount));
  state.jackpotBalances[userId] = next;
  saveState(state);
  return next;
}

function spendJackpotBalance(userId, amount) {
  const state = loadState();
  const spend = Math.floor(Number(amount) || 0);
  const current = Number(state.jackpotBalances[userId] || 0);
  if (!Number.isFinite(spend) || spend <= 0 || current < spend) {
    return false;
  }
  state.jackpotBalances[userId] = current - spend;
  saveState(state);
  return true;
}

function resetAllGamblingData() {
  const emptyState = getEmptyState();
  saveState(emptyState);
  return emptyState;
}

function getDefaultUserStats() {
  return {
    moneyEarned: 0,
    triviaBestRun: {
      all: 0,
      easy: 0,
      medium: 0,
      hard: 0,
    },
    minefieldCompleted: {
      all: 0,
      easy: 0,
      medium: 0,
      hard: 0,
      hardcore: 0,
    },
  };
}

function getUserStatsRecord(state, userId) {
  if (!state.stats[userId] || typeof state.stats[userId] !== 'object') {
    state.stats[userId] = getDefaultUserStats();
  }

  const base = getDefaultUserStats();
  const current = state.stats[userId];
  state.stats[userId] = {
    ...base,
    ...current,
    triviaBestRun: {
      ...base.triviaBestRun,
      ...(current.triviaBestRun || {}),
    },
    minefieldCompleted: {
      ...base.minefieldCompleted,
      ...(current.minefieldCompleted || {}),
    },
  };

  return state.stats[userId];
}

function recordGamblingEarnings(userId, amount) {
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (delta <= 0) return 0;

  const state = loadState();
  const stats = getUserStatsRecord(state, userId);
  stats.moneyEarned = Math.max(0, Math.floor(Number(stats.moneyEarned) || 0) + delta);
  saveState(state);
  return stats.moneyEarned;
}

function recordTriviaRun(userId, perDifficultyCorrect = {}) {
  const easy = Math.max(0, Math.floor(Number(perDifficultyCorrect.easy) || 0));
  const medium = Math.max(0, Math.floor(Number(perDifficultyCorrect.medium) || 0));
  const hard = Math.max(0, Math.floor(Number(perDifficultyCorrect.hard) || 0));
  const all = easy + medium + hard;

  const state = loadState();
  const stats = getUserStatsRecord(state, userId);
  stats.triviaBestRun.easy = Math.max(stats.triviaBestRun.easy, easy);
  stats.triviaBestRun.medium = Math.max(stats.triviaBestRun.medium, medium);
  stats.triviaBestRun.hard = Math.max(stats.triviaBestRun.hard, hard);
  stats.triviaBestRun.all = Math.max(stats.triviaBestRun.all, all);
  saveState(state);
  return stats.triviaBestRun;
}

function incrementMinefieldCompleted(userId, difficulty) {
  const safeDifficulty = ['easy', 'medium', 'hard', 'hardcore'].includes(difficulty) ? difficulty : null;
  if (!safeDifficulty) return null;

  const state = loadState();
  const stats = getUserStatsRecord(state, userId);
  stats.minefieldCompleted[safeDifficulty] += 1;
  stats.minefieldCompleted.all += 1;
  saveState(state);
  return stats.minefieldCompleted;
}

function getGamblingStats(userId) {
  const state = loadState();
  const stats = getUserStatsRecord(state, userId);
  return JSON.parse(JSON.stringify(stats));
}

function getAllGamblingStats() {
  const state = loadState();
  const result = {};
  for (const userId of Object.keys(state.stats || {})) {
    result[userId] = getUserStatsRecord(state, userId);
  }
  return JSON.parse(JSON.stringify(result));
}

function getAllBalances() {
  const state = loadState();
  return JSON.parse(JSON.stringify(state.balances || {}));
}

module.exports = {
  STORE_PATH,
  getBalance,
  setBalance,
  addBalance,
  spendBalance,
  getJackpotBalance,
  addJackpotBalance,
  spendJackpotBalance,
  resetAllGamblingData,
  recordGamblingEarnings,
  recordTriviaRun,
  incrementMinefieldCompleted,
  getGamblingStats,
  getAllGamblingStats,
  getAllBalances,
};
