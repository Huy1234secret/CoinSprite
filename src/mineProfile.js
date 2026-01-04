const fs = require('fs');
const path = require('path');

const MINE_DATA_FILE = path.join(__dirname, '..', 'data', 'mine_profiles.json');

function calculateNextLevelXp(level) {
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  const levelForRequirement = Math.min(safeLevel, 99);
  return 100 + levelForRequirement * 50;
}

const DEFAULT_PROFILE = {
  level: 0,
  xp: 0,
  next_level_xp: calculateNextLevelXp(0),
  mine_upgrade_tokens_used: 0,
  upgrade_tokens: 0,
};

function loadProfiles() {
  if (!fs.existsSync(MINE_DATA_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(MINE_DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (error) {
    console.warn('Failed to read mine profiles; starting fresh.', error);
    return {};
  }
}

function saveProfiles(profiles) {
  fs.mkdirSync(path.dirname(MINE_DATA_FILE), { recursive: true });
  fs.writeFileSync(MINE_DATA_FILE, JSON.stringify(profiles));
}

function ensureProfileShape(profile = {}) {
  const level = Math.min(100, Math.max(0, Math.floor(Number(profile.level) || DEFAULT_PROFILE.level)));
  const xpValue = Number(profile.xp);
  const xp = Math.max(0, Number.isFinite(xpValue) ? xpValue : DEFAULT_PROFILE.xp);
  const used = Math.max(0, Math.floor(Number(profile.mine_upgrade_tokens_used) || 0));

  return {
    ...DEFAULT_PROFILE,
    ...profile,
    level,
    xp,
    mine_upgrade_tokens_used: used,
    next_level_xp: calculateNextLevelXp(level),
  };
}

function ensureUpgradeTokenBalance(profile) {
  const tokensOwned = Math.max(0, Math.floor(Number(profile.level) || 0));
  return { ...profile, upgrade_tokens: Math.max(0, tokensOwned - profile.mine_upgrade_tokens_used) };
}

function getUserMineProfile(userId) {
  const profiles = loadProfiles();
  const userKey = String(userId);
  const existing = ensureUpgradeTokenBalance(ensureProfileShape(profiles[userKey]));
  profiles[userKey] = existing;
  saveProfiles(profiles);
  return existing;
}

function updateUserMineProfile(userId, profile) {
  const profiles = loadProfiles();
  profiles[String(userId)] = ensureUpgradeTokenBalance(ensureProfileShape(profile));
  saveProfiles(profiles);
}

function addMineXp(userId, amount) {
  const profiles = loadProfiles();
  const userKey = String(userId);
  const profile = ensureUpgradeTokenBalance(ensureProfileShape(profiles[userKey]));
  let xp = Math.max(0, profile.xp + Math.max(0, Math.floor(Number(amount) || 0)));
  let level = profile.level;

  while (level < 100 && xp >= calculateNextLevelXp(level)) {
    xp -= calculateNextLevelXp(level);
    level += 1;
  }

  const updated = ensureUpgradeTokenBalance({
    ...profile,
    level,
    xp,
    next_level_xp: calculateNextLevelXp(level),
  });

  profiles[userKey] = updated;
  saveProfiles(profiles);
  return updated;
}

module.exports = {
  DEFAULT_PROFILE,
  calculateNextLevelXp,
  addMineXp,
  getUserMineProfile,
  updateUserMineProfile,
};
