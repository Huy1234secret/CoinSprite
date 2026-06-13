const levelingStore = require('./levelingStore');
const levelingManager = require('./levelingManager');
const ticketSystemStore = require('./ticketSystemStore');
const { logCommandSystem } = require('./commandLogger');

const MAX_ADMIN_TEXT_LENGTH = 500;

function cleanAdminText(value, maxLength = MAX_ADMIN_TEXT_LENGTH) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, maxLength);
}

function floorOneDecimal(value) {
  return Math.floor(Math.max(0, Number(value) || 0) * 10) / 10;
}

function asInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function totalXpForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  let total = 0;
  for (let current = 1; current < safeLevel; current += 1) {
    total += levelingManager.xpRequirement(current);
  }
  return floorOneDecimal(total);
}

function normalizeStoredUser(user) {
  if (!user || typeof user !== 'object') {
    return {
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

  const normalized = { ...user };
  normalized.totalXp = floorOneDecimal(normalized.totalXp);
  normalized.messages = asInteger(normalized.messages, 0, 0);
  normalized.reactions = asInteger(normalized.reactions, 0, 0);
  normalized.punishTier = asInteger(normalized.punishTier, 0, 0, 5);
  normalized.expLocked = normalized.expLocked === true;
  normalized.expLockReason = normalized.expLocked && typeof normalized.expLockReason === 'string'
    ? cleanAdminText(normalized.expLockReason)
    : null;

  if (!normalized.activePunishment || typeof normalized.activePunishment !== 'object') {
    normalized.activePunishment = null;
  } else {
    const tier = asInteger(normalized.activePunishment.tier, 0, 0, 5);
    const endsAt = Number(normalized.activePunishment.endsAt) || null;
    normalized.activePunishment = tier > 0 ? { tier, endsAt } : null;
  }

  normalized.updatedAt = Number(normalized.updatedAt) || Date.now();
  return normalized;
}

function getTicketBlacklistState(guildId, userId) {
  const state = ticketSystemStore.loadState();
  const blacklist = state.blacklistedUsersByGuild?.[guildId];
  return Array.isArray(blacklist) && blacklist.map(String).includes(String(userId));
}

function setTicketBlacklistState(guildId, userId, enabled) {
  const state = ticketSystemStore.loadState();
  state.blacklistedUsersByGuild ||= {};
  const current = Array.isArray(state.blacklistedUsersByGuild[guildId])
    ? state.blacklistedUsersByGuild[guildId]
    : [];
  const next = new Set(current.map(String).filter((id) => /^\d{16,20}$/.test(id)));
  if (enabled) next.add(String(userId));
  else next.delete(String(userId));
  state.blacklistedUsersByGuild[guildId] = [...next];
  ticketSystemStore.saveState(state);
  return next.has(String(userId));
}

function serializeUserData(guildId, userId, user, found, profile = {}, extras = {}) {
  const normalized = normalizeStoredUser(user);
  const progress = levelingManager.getProgress(normalized.totalXp);
  return {
    guildId,
    userId,
    found: Boolean(found),
    user: profile.user || null,
    member: profile.member || { inGuild: false },
    data: {
      totalXp: normalized.totalXp,
      currentXp: progress.currentXp,
      requiredXp: progress.requiredXp,
      level: progress.level,
      nextLevelTotalXp: floorOneDecimal(normalized.totalXp + progress.requiredXp - progress.currentXp),
      messages: normalized.messages,
      reactions: normalized.reactions,
      punishTier: normalized.punishTier,
      activePunishment: normalized.activePunishment,
      expLocked: normalized.expLocked,
      expLockReason: normalized.expLockReason,
      ticketBlacklisted: extras.ticketBlacklisted === true,
      updatedAt: normalized.updatedAt,
    },
  };
}

async function fetchUserProfile(client, guildId, userId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  const user = member?.user || await client.users.fetch(userId).catch(() => null);

  return {
    user: user ? {
      id: user.id,
      username: user.username,
      globalName: user.globalName || user.username,
      avatarUrl: user.displayAvatarURL?.({ extension: 'png', size: 128 }) || null,
    } : null,
    member: {
      inGuild: Boolean(member),
      displayName: member?.displayName || null,
      joinedTimestamp: member?.joinedTimestamp || null,
    },
  };
}

async function getUserDataPayload(client, guildId, userId) {
  const state = levelingStore.loadState();
  const guild = state.guilds?.[guildId];
  const user = guild?.users?.[userId];
  const profile = await fetchUserProfile(client, guildId, userId);
  const ticketBlacklisted = getTicketBlacklistState(guildId, userId);
  return serializeUserData(guildId, userId, user, Boolean(user), profile, { ticketBlacklisted });
}

function patchStoredUserData(guildId, userId, patch, adminUserId) {
  const state = levelingStore.loadState();
  const guild = levelingStore.ensureGuildState(state, guildId);
  const user = levelingStore.ensureUserState(guild, userId);
  const xpMode = patch?.xpMode === 'level' ? 'level' : 'xp';

  if (xpMode === 'level') {
    user.totalXp = totalXpForLevel(patch.level);
  } else if (Object.prototype.hasOwnProperty.call(patch || {}, 'totalXp')) {
    user.totalXp = floorOneDecimal(patch.totalXp);
  }

  if (Object.prototype.hasOwnProperty.call(patch || {}, 'messages')) {
    user.messages = asInteger(patch.messages, user.messages, 0);
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'reactions')) {
    user.reactions = asInteger(patch.reactions, user.reactions, 0);
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'punishTier')) {
    user.punishTier = asInteger(patch.punishTier, user.punishTier, 0, 5);
  }

  if (patch?.activePunishment && typeof patch.activePunishment === 'object') {
    const tier = asInteger(patch.activePunishment.tier, 0, 0, 5);
    const endsAt = Number(patch.activePunishment.endsAt) || null;
    user.activePunishment = tier > 0 ? { tier, endsAt } : null;
  } else if (Object.prototype.hasOwnProperty.call(patch || {}, 'activePunishment')) {
    user.activePunishment = null;
  }

  if (Object.prototype.hasOwnProperty.call(patch || {}, 'expLocked')) {
    user.expLocked = patch.expLocked === true;
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'expLockReason')) {
    user.expLockReason = user.expLocked ? cleanAdminText(patch.expLockReason) : null;
  } else if (!user.expLocked) {
    user.expLockReason = null;
  }

  user.updatedAt = Date.now();
  user.updatedBy = adminUserId;
  guild.updatedAt = Date.now();
  levelingStore.saveState(state);
  return normalizeStoredUser(user);
}

async function handleUserDataGet(req, res, env, client, guildId, userId, deps) {
  const session = await deps.requireAdmin(req, res, env, client, guildId);
  if (!session) return;
  deps.sendJson(res, 200, await getUserDataPayload(client, guildId, userId));
}

async function handleUserDataPatch(req, res, env, client, guildId, userId, deps) {
  const session = await deps.requireAdmin(req, res, env, client, guildId);
  if (!session) return;
  const patch = await deps.readJsonBody(req);
  const user = patchStoredUserData(guildId, userId, patch, session.user.id);
  const ticketBlacklisted = Object.prototype.hasOwnProperty.call(patch || {}, 'ticketBlacklisted')
    ? setTicketBlacklistState(guildId, userId, patch.ticketBlacklisted === true)
    : getTicketBlacklistState(guildId, userId);
  const profile = await fetchUserProfile(client, guildId, userId);
  deps.sendJson(res, 200, serializeUserData(guildId, userId, user, true, profile, { ticketBlacklisted }));
  logCommandSystem(`Admin ${session.user.id} updated user data for ${userId} in guild ${guildId}.`);
}

module.exports = {
  handleUserDataGet,
  handleUserDataPatch,
};