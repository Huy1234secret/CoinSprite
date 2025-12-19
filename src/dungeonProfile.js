const fs = require('fs');
const path = require('path');

const DUNGEON_PROFILE_FILE = path.join(__dirname, '..', 'data', 'dungeon_profiles.json');

const DEFAULT_DUNGEON_PROFILE = {
  currentStageByDungeon: { '1': 1 },
  completedStagesByDungeon: { '1': [] },
  completedDifficultiesByStage: {},
  firstWinStages: [],
};

function loadDungeonProfiles() {
  if (!fs.existsSync(DUNGEON_PROFILE_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(DUNGEON_PROFILE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (error) {
    console.warn('Failed to read dungeon profiles; starting fresh.', error);
    return {};
  }
}

function saveDungeonProfiles(profiles) {
  const safeProfiles = typeof profiles === 'object' && profiles !== null ? profiles : {};
  fs.mkdirSync(path.dirname(DUNGEON_PROFILE_FILE), { recursive: true });
  fs.writeFileSync(DUNGEON_PROFILE_FILE, JSON.stringify(safeProfiles));
}

function ensureProfileShape(profile = {}) {
  const currentStageByDungeon =
    typeof profile.currentStageByDungeon === 'object' && profile.currentStageByDungeon !== null
      ? profile.currentStageByDungeon
      : { ...DEFAULT_DUNGEON_PROFILE.currentStageByDungeon };
  const completedStagesByDungeon =
    typeof profile.completedStagesByDungeon === 'object' && profile.completedStagesByDungeon !== null
      ? profile.completedStagesByDungeon
      : { ...DEFAULT_DUNGEON_PROFILE.completedStagesByDungeon };
  const completedDifficultiesByStage =
    typeof profile.completedDifficultiesByStage === 'object' &&
    profile.completedDifficultiesByStage !== null
      ? profile.completedDifficultiesByStage
      : {};
  const firstWinStages = Array.isArray(profile.firstWinStages) ? profile.firstWinStages : [];

  return {
    ...DEFAULT_DUNGEON_PROFILE,
    ...profile,
    currentStageByDungeon,
    completedStagesByDungeon,
    completedDifficultiesByStage,
    firstWinStages,
  };
}

function getUserDungeonProfile(userId) {
  const profiles = loadDungeonProfiles();
  const userKey = String(userId);
  const profile = ensureProfileShape(profiles[userKey]);
  profiles[userKey] = profile;
  saveDungeonProfiles(profiles);
  return profile;
}

function updateUserDungeonProfile(userId, profile) {
  const profiles = loadDungeonProfiles();
  profiles[String(userId)] = ensureProfileShape(profile);
  saveDungeonProfiles(profiles);
}

module.exports = {
  DEFAULT_DUNGEON_PROFILE,
  getUserDungeonProfile,
  updateUserDungeonProfile,
};
