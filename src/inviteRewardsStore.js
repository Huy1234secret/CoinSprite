const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'invite-rewards-state.json');

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
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
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
    state.guilds[guildId] = {
      users: {},
      rulesMessageId: null,
      updatedAt: Date.now(),
    };
  }
  if (!state.guilds[guildId].users || typeof state.guilds[guildId].users !== 'object') {
    state.guilds[guildId].users = {};
  }
  return state.guilds[guildId];
}

function ensureUserState(guildState, userId) {
  if (!guildState.users[userId]) {
    guildState.users[userId] = {
      invitePoints: 0,
      rewards: {
        clanRerolls: 0,
        traitRerolls: 0,
        raceRerolls: 0,
      },
      blacklisted: false,
      blacklistReason: '',
      updatedAt: Date.now(),
    };
  }

  const user = guildState.users[userId];
  user.rewards = user.rewards || { clanRerolls: 0, traitRerolls: 0, raceRerolls: 0 };
  user.invitePoints = Number(user.invitePoints) || 0;
  user.rewards.clanRerolls = Number(user.rewards.clanRerolls) || 0;
  user.rewards.traitRerolls = Number(user.rewards.traitRerolls) || 0;
  user.rewards.raceRerolls = Number(user.rewards.raceRerolls) || 0;
  user.blacklisted = Boolean(user.blacklisted);
  user.blacklistReason = user.blacklistReason || '';

  return user;
}

module.exports = {
  STORE_PATH,
  loadState,
  saveState,
  ensureGuildState,
  ensureUserState,
};
