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
  slugKey,
} = require('./stockPayload');
const { loadState, saveState } = require('./stateStore');

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

function roleName(name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim() || 'Unknown';
  return clean.slice(0, 100);
}

function uniqueSpecs(specs) {
  const map = new Map();
  for (const spec of specs) {
    const key = slugKey(spec?.key || spec?.name);
    const name = String(spec?.name || '').trim();
    if (!key || !name || map.has(key)) continue;
    map.set(key, { key, name, roleName: roleName(name) });
  }
  return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function weatherSpecs(weatherPayload, mode) {
  const source = [];
  if (weatherPayload?.current) source.push(weatherPayload.current);
  if (Array.isArray(weatherPayload?.recent)) source.push(...weatherPayload.recent);
  if (mode === 'moon') {
    source.push(...(weatherPayload?.upcomingMoons || []));
    return uniqueSpecs(source.filter((item) => /moon/i.test(`${item?.key || ''} ${item?.name || ''}`)));
  }
  return uniqueSpecs(source.filter((item) => !/moon/i.test(`${item?.key || ''} ${item?.name || ''}`)));
}

async function roleSpecsForTypes(types, fetchers) {
  const specsByType = Object.fromEntries(STOCK_TYPES.map((type) => [type, []]));
  const needItems = types.some((type) => STOCK_TYPE_GROUPS.stock.includes(type)) || types.includes('sell');
  const needWeather = types.some((type) => STOCK_TYPE_GROUPS.weather.includes(type));
  const needSell = types.includes('sell');

  const [items, weather, sell] = await Promise.all([
    needItems ? fetchers.fetchItemsPayload().catch((error) => {
      logCommandSystem(`GAG2 item role source failed: ${error?.message || 'unknown error'}`);
      return [];
    }) : [],
    needWeather ? fetchers.fetchWeatherPayload().catch((error) => {
      logCommandSystem(`GAG2 weather role source failed: ${error?.message || 'unknown error'}`);
      return null;
    }) : null,
    needSell ? fetchers.fetchSellPayload().catch((error) => {
      logCommandSystem(`GAG2 sell role source failed: ${error?.message || 'unknown error'}`);
      return null;
    }) : null,
  ]);

  if (needItems) {
    for (const type of STOCK_TYPE_GROUPS.stock) {
      specsByType[type] = uniqueSpecs(items.filter((item) => item.type === type));
    }
  }
  if (weather) {
    specsByType.weather = weatherSpecs(weather, 'weather');
    specsByType.moon = weatherSpecs(weather, 'moon');
  }
  if (sell) {
    specsByType.sell = uniqueSpecs([
      { key: 'sell_price', name: 'Sell Price' },
      ...items.filter((item) => item.type === 'fruit'),
      ...(sell.entries || []),
    ]);
  }
  return specsByType;
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
    if (bucket.lastPostedKey === postKey && bucket.channelId === target.channelId) return null;

    const channel = await getSendableChannel(this.client, target.channelId);
    if (!channel) throw new Error(`channel ${target.channelId} is unavailable or not sendable`);

    const message = await channel.send(buildTypePayload(target.type, entry, { roleIds: target.roleIds }));
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
}) {
  if (!isGuildGag2StockEnabled(guildId)) return null;
  const guild = client?.guilds?.cache?.get?.(guildId) || await client?.guilds?.fetch?.(guildId).catch(() => null);
  if (!guild) return null;
  const config = getGuildConfig(guild.id);
  const enabledTypes = STOCK_TYPES.filter((type) => cleanChannelId(config?.gag2Stock?.channels?.[type]));
  if (!enabledTypes.length) return null;

  const me = guild.members?.me || await guild.members?.fetchMe?.().catch(() => null);
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    logCommandSystem(`GAG2 role sync skipped for guild ${guild.id}: bot lacks Manage Roles.`);
    return null;
  }

  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const byName = new Map([...roles.values()].map((role) => [role.name.toLowerCase(), role]));
  const specsByType = await roleSpecsForTypes(enabledTypes, fetchers);
  const result = {};

  for (const type of enabledTypes) {
    const roleIds = { ...(config?.gag2Stock?.roleIds?.[type] || {}) };
    for (const spec of specsByType[type] || []) {
      const existingId = roleIds[spec.key];
      if (existingId && roles.has(existingId)) continue;
      let role = byName.get(spec.roleName.toLowerCase()) || null;
      if (!role) {
        if (roles.size >= 250) {
          logCommandSystem(`GAG2 role sync stopped for guild ${guild.id}: Discord role limit reached.`);
          break;
        }
        role = await guild.roles.create({
          name: spec.roleName,
          mentionable: true,
          reason: `CoinSprite GAG2 ${type} notification role`,
        }).catch((error) => {
          logCommandSystem(`GAG2 role create failed in guild ${guild.id} (${spec.roleName}): ${error?.message || 'unknown error'}`);
          return null;
        });
        if (!role) continue;
        roles.set(role.id, role);
        byName.set(role.name.toLowerCase(), role);
      }
      roleIds[spec.key] = role.id;
    }
    updateGuildGag2StockRoleIds(guild.id, type, roleIds);
    result[type] = Object.keys(roleIds).length;
  }

  return result;
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
  roleSpecsForTypes,
  startGag2StockPoster,
  syncAllGag2StockSetups,
  syncGag2StockGuildSetup,
};
