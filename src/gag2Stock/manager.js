const { PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('../commandLogger');
const {
  getEnabledGuildIds,
  getGuildConfig,
  isGuildGag2StockEnabled,
  updateGuildGag2StockRoleIds,
} = require('../serverConfig');
const {
  CHECK_INTERVAL_MS,
  STATE_PATH,
  STOCK_TYPE_GROUPS,
  STOCK_TYPES,
} = require('./config');
const {
  fetchItemsPayload,
  fetchSellPayload,
  fetchStockPayload,
  fetchWeatherPayload,
} = require('./source');
const {
  buildTypePayload,
  buildTypePostKey,
  buildUnavailablePayload,
} = require('./stockPayload');
const { roleSpecsForType } = require('./catalog');
const { loadState, saveState } = require('./stateStore');

const setupProgress = new Map();

function progressSnapshot(value = {}) {
  return {
    action: value.action || 'idle',
    remaining: Math.max(0, Number(value.remaining) || 0),
    total: Math.max(0, Number(value.total) || 0),
    status: value.status || 'idle',
    message: String(value.message || ''),
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

function setGag2StockSetupProgress(guildId, patch) {
  const id = String(guildId || '').trim();
  if (!id) return null;
  const current = setupProgress.get(id) || progressSnapshot();
  const next = progressSnapshot({ ...current, ...patch, updatedAt: new Date().toISOString() });
  setupProgress.set(id, next);
  return next;
}

function getGag2StockSetupProgress(guildId) {
  const id = String(guildId || '').trim();
  return progressSnapshot(setupProgress.get(id));
}

function cleanChannelId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function postBucket(state, guildId, type) {
  state.posts ||= {};
  state.posts[guildId] ||= {};
  state.posts[guildId][type] ||= {};
  return state.posts[guildId][type];
}

function unavailableBucket(state, guildId, type) {
  state.unavailable ||= {};
  state.unavailable[guildId] ||= {};
  state.unavailable[guildId][type] ||= {};
  return state.unavailable[guildId][type];
}

function roleColor(spec) {
  return Number.isInteger(spec?.color) ? spec.color : undefined;
}

async function updateRoleColorIfNeeded(role, spec, guildId) {
  const color = roleColor(spec);
  if (!Number.isInteger(color) || !role || role.color === color || role.editable === false || typeof role.edit !== 'function') return;
  await role.edit({
    color,
    reason: 'CoinSprite GAG2 notification role color sync',
  }).catch((error) => {
    logCommandSystem(`GAG2 role color update failed in guild ${guildId} (${spec.roleName}): ${error?.message || 'unknown error'}`);
  });
}

async function roleSpecsForTypes(types) {
  const specsByType = Object.fromEntries(STOCK_TYPES.map((type) => [type, []]));
  for (const type of types) specsByType[type] = roleSpecsForType(type);
  return specsByType;
}

function roleIdsForTypes(config, types) {
  const ids = new Set();
  for (const type of types) {
    for (const roleId of Object.values(config?.gag2Stock?.roleIds?.[type] || {})) {
      const clean = String(roleId || '').trim();
      if (clean) ids.add(clean);
    }
  }
  return ids;
}

async function clearDisabledTypeRoles(guild, config, enabledTypes, roles, progress) {
  const disabled = STOCK_TYPES.filter((type) => !enabledTypes.includes(type));
  const enabledRoleIds = roleIdsForTypes(config, enabledTypes);
  const deleteCandidates = new Map();

  for (const type of disabled) {
    for (const roleId of Object.values(config?.gag2Stock?.roleIds?.[type] || {})) {
      const clean = String(roleId || '').trim();
      if (!clean || enabledRoleIds.has(clean) || deleteCandidates.has(clean)) continue;
      const role = roles.get(clean);
      if (role && typeof role.delete === 'function') deleteCandidates.set(clean, role);
    }
  }

  let remaining = deleteCandidates.size;
  const total = remaining;
  let removed = 0;
  let failed = 0;
  if (remaining) progress?.({ action: 'removing', remaining, total, status: 'running', message: `Removing ${remaining} roles` });

  for (const [roleId, role] of deleteCandidates) {
    const deleted = await role.delete(`CoinSprite GAG2 category unassigned`).then(() => true).catch((error) => {
      logCommandSystem(`GAG2 role delete failed in guild ${guild.id} (${role.name || roleId}): ${error?.message || 'unknown error'}`);
      progress?.({ action: 'removing', remaining, total, status: 'error', message: `Could not remove ${role.name || 'role'}` });
      return false;
    });
    if (deleted) {
      roles.delete?.(roleId);
      removed += 1;
      remaining -= 1;
      progress?.({ action: 'removing', remaining, total, status: remaining ? 'running' : 'done', message: `Removing ${remaining} roles` });
    } else {
      failed += 1;
    }
  }

  for (const type of disabled) {
    const roleIds = { ...(config?.gag2Stock?.roleIds?.[type] || {}) };
    if (!Object.keys(roleIds).length) continue;
    updateGuildGag2StockRoleIds(guild.id, type, {});
  }
  return { removed, failed, total };
}

async function getSendableChannel(client, channelId) {
  const id = cleanChannelId(channelId);
  if (!id) return null;
  const channel = client?.channels?.cache?.get?.(id) || await client?.channels?.fetch?.(id).catch(() => null);
  return channel?.isTextBased?.() && typeof channel.send === 'function' ? channel : null;
}

async function fetchEntriesForTargets(targets, fetchers) {
  const entries = new Map();
  const errors = new Map();
  const needStock = targets.some((target) => STOCK_TYPE_GROUPS.stock.includes(target.type));
  const needWeather = targets.some((target) => STOCK_TYPE_GROUPS.weather.includes(target.type));
  const needSell = targets.some((target) => target.type === 'sell');

  if (needStock) {
    try {
      const stockPayload = await fetchers.fetchStockPayload();
      for (const entry of stockPayload.stock) entries.set(entry.category, entry);
    } catch (error) {
      for (const type of STOCK_TYPE_GROUPS.stock) errors.set(type, error);
    }
  }

  if (needWeather) {
    try {
      const weatherPayload = await fetchers.fetchWeatherPayload();
      entries.set('weather', weatherPayload);
      entries.set('moon', weatherPayload);
    } catch (error) {
      errors.set('weather', error);
      errors.set('moon', error);
    }
  }

  if (needSell) {
    try {
      entries.set('sell', await fetchers.fetchSellPayload());
    } catch (error) {
      errors.set('sell', error);
    }
  }

  return { entries, errors };
}

class Gag2StockPoster {
  constructor(client, options = {}) {
    this.client = client;
    this.checkIntervalMs = options.checkIntervalMs || CHECK_INTERVAL_MS;
    this.fetchers = {
      fetchItemsPayload: options.fetchItemsPayload || fetchItemsPayload,
      fetchSellPayload: options.fetchSellPayload || fetchSellPayload,
      fetchStockPayload: options.fetchStockPayload || fetchStockPayload,
      fetchWeatherPayload: options.fetchWeatherPayload || fetchWeatherPayload,
    };
    this.now = options.now || (() => Date.now());
    this.statePath = options.statePath || STATE_PATH;
    this.inFlight = false;
    this.timer = null;
  }

  async start() {
    if (this.timer) return this;
    await this.tick();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        logCommandSystem(`GAG2 stock tick failed: ${error?.message || 'unknown error'}`);
      });
    }, this.checkIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    setTimeout(() => syncAllGag2StockSetups(this.client, this.fetchers), 5_000).unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  targets() {
    const targets = [];
    for (const guildId of getEnabledGuildIds()) {
      if (!isGuildGag2StockEnabled(guildId)) continue;
      const config = getGuildConfig(guildId);
      const channels = config?.gag2Stock?.channels || {};
      for (const type of STOCK_TYPES) {
        const channelId = cleanChannelId(channels[type]);
        if (!channelId) continue;
        targets.push({
          guildId,
          type,
          channelId,
          roleIds: config?.gag2Stock?.roleIds?.[type] || {},
        });
      }
    }
    return targets;
  }

  async tick() {
    if (this.inFlight) return null;
    this.inFlight = true;

    try {
      const targets = this.targets();
      if (!targets.length) return null;
      const state = loadState(this.statePath);
      const { entries, errors } = await fetchEntriesForTargets(targets, this.fetchers);
      const sent = [];

      for (const target of targets) {
        const error = errors.get(target.type);
        if (error) {
          const message = await this.postUnavailableOnce(state, target, error).catch((postError) => {
            logCommandSystem(`GAG2 ${target.type} unavailable notice failed: ${postError?.message || 'unknown error'}`);
            return null;
          });
          if (message) sent.push(message);
          continue;
        }

        const entry = entries.get(target.type);
        if (!entry) continue;
        const message = await this.postEntry(state, target, entry).catch((postError) => {
          logCommandSystem(`GAG2 ${target.type} post failed in guild ${target.guildId}: ${postError?.message || 'unknown error'}`);
          return null;
        });
        if (message) sent.push(message);
      }
      return sent;
    } catch (error) {
      logCommandSystem(`GAG2 stock failed: ${error?.message || 'unknown error'}`);
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  async postEntry(state, target, entry) {
    const bucket = postBucket(state, target.guildId, target.type);
    const postKey = buildTypePostKey(target.type, entry);
    const samePost = bucket.lastPostedKey === postKey && bucket.channelId === target.channelId;
    if (samePost && target.type !== 'moon') return null;

    const channel = await getSendableChannel(this.client, target.channelId);
    if (!channel) throw new Error(`channel ${target.channelId} is unavailable or not sendable`);

    const payload = buildTypePayload(target.type, entry, { roleIds: target.roleIds });
    let message = null;
    if (target.type === 'moon' && bucket.lastMessageId) {
      const existing = await channel.messages?.fetch?.(bucket.lastMessageId).catch(() => null);
      if (samePost && existing) return null;
      message = await existing?.edit?.(payload).catch((error) => {
        logCommandSystem(`GAG2 moon prediction edit failed in guild ${target.guildId}: ${error?.message || 'unknown error'}`);
        return null;
      });
    }
    if (!message) message = await channel.send(payload);
    Object.assign(bucket, {
      channelId: target.channelId,
      lastMessageId: message?.id || null,
      lastPostedAt: new Date(this.now()).toISOString(),
      lastPostedKey: postKey,
    });
    saveState(state, this.statePath);
    logCommandSystem(`GAG2 ${target.type} posted to ${target.channelId}: ${postKey}`);
    return message;
  }

  async postUnavailableOnce(state, target, error) {
    const bucket = unavailableBucket(state, target.guildId, target.type);
    const dayBucket = new Date(this.now()).toISOString().slice(0, 10);
    const postKey = `unavailable:${target.channelId}:${dayBucket}`;
    if (bucket.lastPostedKey === postKey) return null;

    const channel = await getSendableChannel(this.client, target.channelId);
    if (!channel) throw new Error(`channel ${target.channelId} is unavailable or not sendable`);
    const message = await channel.send(buildUnavailablePayload(target.type, error?.message || 'Unknown error', this.now()));
    Object.assign(bucket, {
      channelId: target.channelId,
      lastMessageId: message?.id || null,
      lastPostedAt: new Date(this.now()).toISOString(),
      lastPostedKey: postKey,
    });
    saveState(state, this.statePath);
    return message;
  }
}

async function syncGag2StockGuildSetup(client, guildId, fetchers = {
  fetchItemsPayload,
  fetchSellPayload,
  fetchWeatherPayload,
}, options = {}) {
  if (fetchers && typeof fetchers === 'object' && !fetchers.fetchItemsPayload && (fetchers.progressGuildId || fetchers.onProgress)) {
    options = fetchers;
    fetchers = { fetchItemsPayload, fetchSellPayload, fetchWeatherPayload };
  }
  const progressGuildId = options.progressGuildId || '';
  const progress = (patch) => {
    options.onProgress?.(patch);
    if (progressGuildId) setGag2StockSetupProgress(progressGuildId, patch);
  };
  progressGuildId && progress({ action: 'checking', remaining: 0, total: 0, status: 'running', message: 'Checking roles' });
  if (!isGuildGag2StockEnabled(guildId)) {
    progressGuildId && progress({ action: 'checking', remaining: 0, total: 0, status: 'done', message: 'GAG2 stock is disabled' });
    return null;
  }
  const guild = client?.guilds?.cache?.get?.(guildId) || await client?.guilds?.fetch?.(guildId).catch(() => null);
  if (!guild) {
    progressGuildId && progress({ action: 'checking', remaining: 0, total: 0, status: 'error', message: 'Server is unavailable' });
    return null;
  }
  const config = getGuildConfig(guild.id);
  const enabledTypes = STOCK_TYPES.filter((type) => cleanChannelId(config?.gag2Stock?.channels?.[type]));

  const me = guild.members?.me || await guild.members?.fetchMe?.().catch(() => null);
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    logCommandSystem(`GAG2 role sync skipped for guild ${guild.id}: bot lacks Manage Roles.`);
    progressGuildId && progress({ action: 'checking', remaining: 0, total: 0, status: 'error', message: 'Bot lacks Manage Roles' });
    return null;
  }

  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const removal = await clearDisabledTypeRoles(guild, config, enabledTypes, roles, progress);
  if (!enabledTypes.length) {
    if (!removal.failed) progressGuildId && progress({ action: removal.removed ? 'removing' : 'checking', remaining: 0, total: removal.removed, status: 'done', message: removal.removed ? 'Removed roles' : 'No roles needed' });
    return { removed: removal.removed, failed: removal.failed, added: 0 };
  }

  const byName = new Map([...roles.values()].map((role) => [role.name.toLowerCase(), role]));
  const specsByType = await roleSpecsForTypes(enabledTypes, fetchers);
  const result = {};
  let addRemaining = 0;
  for (const type of enabledTypes) {
    const roleIds = { ...(config?.gag2Stock?.roleIds?.[type] || {}) };
    for (const spec of specsByType[type] || []) {
      const existingId = roleIds[spec.key];
      if (existingId && roles.has(existingId)) continue;
      if (byName.has(spec.roleName.toLowerCase())) continue;
      addRemaining += 1;
    }
  }
  const addTotal = addRemaining;
  if (addTotal) progress?.({ action: 'adding', remaining: addRemaining, total: addTotal, status: 'running', message: `Adding ${addRemaining} roles` });

  for (const type of enabledTypes) {
    const roleIds = { ...(config?.gag2Stock?.roleIds?.[type] || {}) };
    for (const spec of specsByType[type] || []) {
      const existingId = roleIds[spec.key];
      if (existingId && roles.has(existingId)) {
        await updateRoleColorIfNeeded(roles.get(existingId), spec, guild.id);
        continue;
      }
      let role = byName.get(spec.roleName.toLowerCase()) || null;
      if (!role) {
        if (roles.size >= 250) {
          logCommandSystem(`GAG2 role sync stopped for guild ${guild.id}: Discord role limit reached.`);
          break;
        }
        const createOptions = {
          name: spec.roleName,
          mentionable: true,
          reason: `CoinSprite GAG2 ${type} notification role`,
        };
        const color = roleColor(spec);
        if (Number.isInteger(color)) createOptions.color = color;
        role = await guild.roles.create(createOptions).catch((error) => {
          logCommandSystem(`GAG2 role create failed in guild ${guild.id} (${spec.roleName}): ${error?.message || 'unknown error'}`);
          return null;
        });
        if (!role) {
          progress?.({ action: 'adding', remaining: addRemaining, total: addTotal, status: 'error', message: `Could not add ${spec.roleName}` });
          continue;
        }
        if (addRemaining > 0) {
          addRemaining -= 1;
          progress?.({ action: 'adding', remaining: addRemaining, total: addTotal, status: addRemaining ? 'running' : 'done', message: `Adding ${addRemaining} roles` });
        }
        roles.set(role.id, role);
        byName.set(role.name.toLowerCase(), role);
      }
      await updateRoleColorIfNeeded(role, spec, guild.id);
      roleIds[spec.key] = role.id;
    }
    updateGuildGag2StockRoleIds(guild.id, type, roleIds);
    result[type] = Object.keys(roleIds).length;
  }

  if (!addTotal && progressGuildId && !removal.failed) progress({ action: removal.removed ? 'removing' : 'checking', remaining: 0, total: removal.removed, status: 'done', message: removal.removed ? 'Removed roles' : 'Roles already synced' });
  return { ...result, added: addTotal - addRemaining, removed: removal.removed, failed: removal.failed };
}

async function syncAllGag2StockSetups(client, fetchers) {
  for (const guildId of getEnabledGuildIds()) {
    await syncGag2StockGuildSetup(client, guildId, fetchers).catch((error) => {
      logCommandSystem(`GAG2 role sync failed for guild ${guildId}: ${error?.message || 'unknown error'}`);
    });
  }
}

let activePoster = null;

async function startGag2StockPoster(client, options = {}) {
  if (activePoster) return activePoster;
  activePoster = new Gag2StockPoster(client, options);
  await activePoster.start();
  return activePoster;
}

module.exports = {
  Gag2StockPoster,
  getGag2StockSetupProgress,
  roleSpecsForTypes,
  startGag2StockPoster,
  syncAllGag2StockSetups,
  syncGag2StockGuildSetup,
};
