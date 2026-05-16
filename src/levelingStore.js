const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'leveling-state.json');
const LEVELING_SCHEMA_VERSION = 2;
const XP_MIGRATION_MULTIPLIER = 0.4122;

function floorOneDecimal(value) {
  return Math.floor(Math.max(0, Number(value) || 0) * 10) / 10;
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ guilds: {} }, null, 2), 'utf8');
  }
}

function runMigrations(state) {
  if (!state.meta || typeof state.meta !== 'object') {
    state.meta = {};
  }

  const currentVersion = Number(state.meta.levelingSchemaVersion) || 1;
  if (currentVersion >= LEVELING_SCHEMA_VERSION) {
    return false;
  }

  if (currentVersion < 2) {
    for (const guild of Object.values(state.guilds || {})) {
      if (!guild?.users || typeof guild.users !== 'object') {
        continue;
      }

      for (const user of Object.values(guild.users)) {
        user.totalXp = floorOneDecimal((Number(user.totalXp) || 0) * XP_MIGRATION_MULTIPLIER);
      }

      guild.updatedAt = Date.now();
    }
  }

  state.meta.levelingSchemaVersion = LEVELING_SCHEMA_VERSION;
  state.meta.updatedAt = Date.now();
  return true;
}

function loadState() {
  ensureStoreFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.guilds !== 'object') {
      return { guilds: {} };
    }

    if (runMigrations(parsed)) {
      saveState(parsed);
    }

    return parsed;
  } catch {
    return { guilds: {} };
  }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function ensureGuildState(state, guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = { users: {}, updatedAt: Date.now() };
  }

  if (!state.guilds[guildId].users || typeof state.guilds[guildId].users !== 'object') {
    state.guilds[guildId].users = {};
  }

  return state.guilds[guildId];
}

function ensureUserState(guildState, userId) {
  if (!guildState.users[userId]) {
    guildState.users[userId] = {
      totalXp: 0,
      messages: 0,
      reactions: 0,
      punishTier: 0,
      activePunishment: null,
      expLocked: false,
      expLockReason: null,
      updatedAt: Date.now(),
    };
  }

  const user = guildState.users[userId];
  user.totalXp = Number(user.totalXp) || 0;
  user.messages = Number(user.messages) || 0;
  user.reactions = Number(user.reactions) || 0;
  user.punishTier = Math.max(0, Math.floor(Number(user.punishTier) || 0));
  user.expLocked = user.expLocked === true;
  user.expLockReason = user.expLocked && typeof user.expLockReason === 'string' ? user.expLockReason.trim() : null;
  if (!user.activePunishment || typeof user.activePunishment !== 'object') {
    user.activePunishment = null;
  } else {
    const tier = Math.floor(Number(user.activePunishment.tier) || 0);
    const endsAt = Number(user.activePunishment.endsAt) || null;
    user.activePunishment = tier > 0 ? { tier, endsAt } : null;
  }
  user.updatedAt = Number(user.updatedAt) || Date.now();

  return user;
}

module.exports = {
  loadState,
  saveState,
  ensureGuildState,
  ensureUserState,
  STORE_PATH,
};
