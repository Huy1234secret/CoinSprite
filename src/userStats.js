const fs = require('fs');
const path = require('path');

const USER_STATS_FILE = path.join(__dirname, '..', 'data', 'user_stats.json');

const DEFAULT_STATS = {
  level: 0,
  xp: 0,
  coins: 0,
  diamonds: 0,
  prismatic: 0,
};

function loadStats() {
  if (!fs.existsSync(USER_STATS_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(USER_STATS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    console.warn('Failed to read user stats, starting fresh.', error);
    return {};
  }
}

function saveStats(stats) {
  const safeStats = typeof stats === 'object' && stats !== null ? stats : {};
  fs.mkdirSync(path.dirname(USER_STATS_FILE), { recursive: true });
  fs.writeFileSync(USER_STATS_FILE, JSON.stringify(safeStats));
}

function getNextLevelRequirement(level) {
  if (level >= 100) {
    return null;
  }

  return Math.ceil(100 * Math.pow(1.25, level));
}

function ensureStatsShape(stats = {}) {
  return {
    ...DEFAULT_STATS,
    ...stats,
    level: Math.min(Math.max(0, stats.level ?? DEFAULT_STATS.level), 100),
    xp: Math.max(0, stats.xp ?? DEFAULT_STATS.xp),
    coins: Math.max(0, stats.coins ?? DEFAULT_STATS.coins),
    diamonds: Math.max(0, stats.diamonds ?? DEFAULT_STATS.diamonds),
    prismatic: Math.max(0, stats.prismatic ?? DEFAULT_STATS.prismatic),
  };
}

function setUserStats(userId, stats) {
  const allStats = loadStats();
  allStats[String(userId)] = ensureStatsShape(stats);
  saveStats(allStats);
  return allStats[String(userId)];
}

function getUserStats(userId) {
  const allStats = loadStats();
  const userKey = String(userId);
  const existing = ensureStatsShape(allStats[userKey]);
  allStats[userKey] = existing;
  saveStats(allStats);
  return existing;
}

function applyXpGains(stats, amount) {
  let remaining = Math.max(0, amount);
  let updated = { ...stats };

  while (remaining > 0 && updated.level < 100) {
    const requirement = getNextLevelRequirement(updated.level);
    if (!requirement) {
      break;
    }

    const space = requirement - updated.xp;
    if (remaining >= space) {
      updated = { ...updated, xp: 0, level: updated.level + 1 };
      remaining -= space;
      continue;
    }

    updated = { ...updated, xp: updated.xp + remaining };
    remaining = 0;
  }

  if (updated.level >= 100) {
    updated = { ...updated, level: 100, xp: 0 };
  }

  return updated;
}

function addXpToUser(userId, amount) {
  const current = getUserStats(userId);
  const withXp = applyXpGains(current, amount);
  return setUserStats(userId, withXp);
}

function buildProgressBar(current, total, width = 20) {
  const safeTotal = Math.max(1, total);
  const ratio = Math.max(0, Math.min(1, current / safeTotal));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

module.exports = {
  DEFAULT_STATS,
  addXpToUser,
  buildProgressBar,
  getNextLevelRequirement,
  getUserStats,
  setUserStats,
};
