const fs = require('fs');
const path = require('path');

const USER_STATS_FILE = path.join(__dirname, '..', 'data', 'user_stats.json');
const { addItemToInventory, getUserProfile, updateUserProfile, UPGRADE_TOKEN_ITEM } = require('./huntProfile');

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

function grantUpgradeTokens(userId, amount) {
  const safeAmount = Math.max(0, amount);
  if (safeAmount === 0 || !UPGRADE_TOKEN_ITEM) {
    return;
  }

  const profile = getUserProfile(userId);
  addItemToInventory(profile, UPGRADE_TOKEN_ITEM, safeAmount);
  updateUserProfile(userId, profile);
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
  const leveledUp = Math.max(0, withXp.level - current.level);
  const saved = setUserStats(userId, withXp);

  if (leveledUp > 0) {
    grantUpgradeTokens(userId, leveledUp * 5);
  }

  return saved;
}

function addCoinsToUser(userId, amount) {
  const current = getUserStats(userId);
  const updatedCoins = Math.max(0, current.coins + amount);
  return setUserStats(userId, { ...current, coins: updatedCoins });
}

function addDiamondsToUser(userId, amount) {
  const current = getUserStats(userId);
  const updatedDiamonds = Math.max(0, current.diamonds + amount);
  return setUserStats(userId, { ...current, diamonds: updatedDiamonds });
}

function addPrismaticToUser(userId, amount) {
  const current = getUserStats(userId);
  const updatedPrismatic = Math.max(0, current.prismatic + amount);
  return setUserStats(userId, { ...current, prismatic: updatedPrismatic });
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
  addCoinsToUser,
  addDiamondsToUser,
  addPrismaticToUser,
  buildProgressBar,
  getNextLevelRequirement,
  getUserStats,
  setUserStats,
};
