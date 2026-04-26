const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'leveling-state.json');

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ guilds: {} }, null, 2), 'utf8');
  }
}

function loadState() {
  ensureStoreFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.guilds !== 'object') {
      return { guilds: {} };
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
      updatedAt: Date.now(),
    };
  }

  const user = guildState.users[userId];
  user.totalXp = Number(user.totalXp) || 0;
  user.messages = Number(user.messages) || 0;
  user.reactions = Number(user.reactions) || 0;
  user.punishTier = Math.max(0, Math.floor(Number(user.punishTier) || 0));
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
