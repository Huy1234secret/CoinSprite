const { PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('../commandLogger');
const {
  GAG2_ROLE_FILTER_RARITIES,
  GAG2_SELL_FILTER_RARITIES,
  GAG2_SELL_MULTIPLIERS,
  getEnabledGuildIds,
  getGuildConfig,
  isGuildGag2StockEnabled,
  updateGuildGag2StockRoleIds,
} = require('../serverConfig');
const {
  CHECK_INTERVAL_MS,
  CHECK_SCHEDULE_SECOND_MS,
  CHECK_SCHEDULE_UTC_OFFSET_MS,
  SELL_CHECK_INTERVAL_MS,
  SELL_CHECK_SCHEDULE_SECOND_MS,
  SELL_UNCHANGED_RETRY_MS,
  STATE_PATH,
  STALE_STOCK_RETRY_MS,
  STOCK_TYPE_GROUPS,
  STOCK_TYPES,
  TRANSIENT_UNAVAILABLE_NOTICE_FAILURES,
  WEATHER_CHECK_INTERVAL_MS,
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
const {
  normalizeRarity,
  rarityForType,
  roleSpecsForType,
  sellMultiplierBucket,
} = require('./catalog');
const { syncAllGag2RoleAssignmentPanels } = require('./roleAssignment');
const { loadState, saveState } = require('./stateStore');
const {
  DEFAULT_GAG2_BROADCAST_CONCURRENCY,
  mapWithConcurrency,
  normalizeConcurrency,
} = require('./concurrency');

const setupProgress = new Map();
const STOCK_POST_TYPES = Object.freeze([...STOCK_TYPE_GROUPS.stock]);
const WEATHER_POST_TYPES = Object.freeze([...STOCK_TYPE_GROUPS.weather]);
const SELL_POST_TYPES = Object.freeze([...STOCK_TYPE_GROUPS.sell]);
const RECENT_SELL_DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const RECENT_SELL_POST_KEY_LIMIT = 24;
const SOURCE_FAILURE_LOG_INTERVAL_MS = 60 * 1000;
const POST_PERMISSION_CHECK_LIMIT = 5;
const POST_PERMISSION_RETRY_MS = 5 * 1000;

const POST_PERMISSION_LABELS = Object.freeze([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.SendMessagesInThreads, 'Send Messages in Threads'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
  [PermissionFlagsBits.UseExternalEmojis, 'Use External Emojis'],
]);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function permissionSetHas(permissions, flag) {
  try {
    return permissions?.has?.(flag) === true;
  } catch {
    return false;
  }
}

function requiredPostPermissionFlags(channel, type, options = {}) {
  const thread = channel?.isThread?.() === true;
  const flags = [
    PermissionFlagsBits.ViewChannel,
    thread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
  ];
  if (options.useExternalEmojis !== false) flags.push(PermissionFlagsBits.UseExternalEmojis);
  if (options.requireHistory !== false && (type === 'moon' || type === 'sell')) flags.push(PermissionFlagsBits.ReadMessageHistory);
  return flags;
}

function diagnosePostPermissions(channel, member, type, options = {}) {
  if (!channel || typeof channel.permissionsFor !== 'function') {
    return { server: [], channel: [], unknown: ['Unable to read channel permissions'] };
  }
  let effective = null;
  try {
    effective = channel.permissionsFor(member);
  } catch {}
  if (!effective || typeof effective.has !== 'function') {
    return { server: [], channel: [], unknown: ['Unable to read channel permissions'] };
  }

  const labels = new Map(POST_PERMISSION_LABELS);
  const result = { server: [], channel: [], unknown: [] };
  for (const flag of requiredPostPermissionFlags(channel, type, options)) {
    if (permissionSetHas(effective, flag)) continue;
    const label = labels.get(flag) || String(flag);
    if (member?.permissions && !permissionSetHas(member.permissions, flag)) result.server.push(label);
    else result.channel.push(label);
  }
  return result;
}

function hasMissingPostPermissions(diagnostic) {
  return Boolean(diagnostic?.server?.length || diagnostic?.channel?.length);
}

function isDiscordMissingPermissionsError(error) {
  return Number(error?.code) === 50013 || /missing permissions/i.test(String(error?.message || ''));
}

function nextGag2StockTickAtMs(nowMs = Date.now(), options = {}) {
  const intervalMs = Math.max(1_000, finiteNumber(options.intervalMs, CHECK_INTERVAL_MS));
  const secondMs = Math.max(0, Math.min(intervalMs - 1, finiteNumber(options.secondMs, CHECK_SCHEDULE_SECOND_MS)));
  const offsetMs = finiteNumber(options.offsetMs, CHECK_SCHEDULE_UTC_OFFSET_MS);
  const now = finiteNumber(nowMs, Date.now());
  const shiftedNow = now + offsetMs;
  const slotStart = Math.floor(shiftedNow / intervalMs) * intervalMs;
  let nextShifted = slotStart + secondMs;
  if (nextShifted <= shiftedNow) nextShifted += intervalMs;
  return nextShifted - offsetMs;
}

function isStaleStockEntry(type, entry, nowMs = Date.now()) {
  if (!STOCK_TYPE_GROUPS.stock.includes(type)) return false;
  const nextRestockAtMs = Number(entry?.nextRestockAtMs);
  if (!Number.isFinite(nextRestockAtMs)) return false;
  return nextRestockAtMs <= finiteNumber(nowMs, Date.now());
}

function apiRefreshAtMsForEntry(type, entry) {
  if (STOCK_TYPE_GROUPS.stock.includes(type)) return Number(entry?.nextRestockAtMs);
  if (type === 'sell') return Number(entry?.nextRefreshAtMs);
  return null;
}

function nextApiRefreshAtMsForTypes(entries, types, nowMs = Date.now()) {
  const now = finiteNumber(nowMs, Date.now());
  const times = [];
  for (const type of types) {
    const nextAt = apiRefreshAtMsForEntry(type, entries?.get?.(type));
    if (Number.isFinite(nextAt) && nextAt > now) times.push(nextAt);
  }
  return times.length ? Math.min(...times) : null;
}

function isApiRefreshDue(type, entry, nowMs = Date.now()) {
  const nextAt = apiRefreshAtMsForEntry(type, entry);
  return Number.isFinite(nextAt) && nextAt <= finiteNumber(nowMs, Date.now());
}

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

function existingPostBucket(state, guildId, type) {
  return state.posts?.[guildId]?.[type] || null;
}

function recentSellPostKeys(bucket) {
  return Array.isArray(bucket?.recentPostedKeys)
    ? bucket.recentPostedKeys.filter((key) => typeof key === 'string' && key)
    : [];
}

function rememberSellPostKey(bucket, postKey) {
  const key = String(postKey || '');
  if (!key) return false;
  const current = recentSellPostKeys(bucket);
  const next = [key, ...current.filter((entry) => entry !== key)].slice(0, RECENT_SELL_POST_KEY_LIMIT);
  if (next.length === current.length && next.every((entry, index) => entry === current[index])) return false;
  bucket.recentPostedKeys = next;
  return true;
}

function timestampMs(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number > 0 ? number : null;
}

function sellEntryIsOlderThanBucket(bucket, entry) {
  const incomingRefreshAtMs = timestampMs(entry?.nextRefreshAtMs);
  const lastRefreshAtMs = timestampMs(bucket?.lastSellNextRefreshAtMs);
  if (incomingRefreshAtMs !== null && lastRefreshAtMs !== null) {
    if (incomingRefreshAtMs < lastRefreshAtMs) return true;
    if (incomingRefreshAtMs > lastRefreshAtMs) return false;
  }

  const incomingFetchedAtMs = timestampMs(entry?.fetchedAtMs);
  const lastFetchedAtMs = timestampMs(bucket?.lastSourceFetchedAtMs);
  return incomingFetchedAtMs !== null
    && lastFetchedAtMs !== null
    && incomingFetchedAtMs < lastFetchedAtMs;
}

function sellEntryIsSameOrOlderCycle(bucket, entry) {
  const incomingRefreshAtMs = timestampMs(entry?.nextRefreshAtMs);
  const lastRefreshAtMs = timestampMs(bucket?.lastSellNextRefreshAtMs);
  if (incomingRefreshAtMs === null || lastRefreshAtMs === null) return true;
  return incomingRefreshAtMs <= lastRefreshAtMs;
}

function updateSellPostMetadata(bucket, entry) {
  const nextRefreshAtMs = timestampMs(entry?.nextRefreshAtMs);
  const fetchedAtMs = timestampMs(entry?.fetchedAtMs);
  if (nextRefreshAtMs !== null) bucket.lastSellNextRefreshAtMs = nextRefreshAtMs;
  if (fetchedAtMs !== null) bucket.lastSourceFetchedAtMs = fetchedAtMs;
}

function comparableComponent(value) {
  const raw = typeof value?.toJSON === 'function' ? value.toJSON() : (value?.data || value || {});
  const component = { type: Number(raw.type) || 0 };
  if (typeof raw.content === 'string') component.content = raw.content;
  const accentColor = raw.accent_color ?? raw.accentColor;
  if (Number.isInteger(accentColor)) component.accent_color = accentColor;
  if (Array.isArray(raw.components)) component.components = raw.components.map(comparableComponent);
  if (raw.accessory) component.accessory = comparableComponent(raw.accessory);
  const mediaUrl = raw.media?.url || raw.media?.proxy_url || raw.media?.proxyUrl;
  if (mediaUrl) component.media = { url: String(mediaUrl) };
  return component;
}

function componentFingerprint(components) {
  return JSON.stringify((Array.isArray(components) ? components : []).map(comparableComponent));
}

async function findMatchingRecentBotMessage(channel, clientUserId, payload, nowMs = Date.now()) {
  if (typeof channel?.messages?.fetch !== 'function') return null;
  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!messages || typeof messages.values !== 'function') return null;
  const expected = componentFingerprint(payload?.components);
  for (const message of messages.values()) {
    const ownMessage = clientUserId
      ? message?.author?.id === clientUserId
      : message?.author?.bot === true;
    if (!ownMessage) continue;
    const createdAt = Number(message?.createdTimestamp);
    if (Number.isFinite(createdAt) && createdAt < nowMs - RECENT_SELL_DEDUPE_WINDOW_MS) continue;
    if (componentFingerprint(message?.components) === expected) return message;
  }
  return null;
}

function isTransientSourceError(error) {
  if (error?.gag2Transient) return true;
  const message = String(error?.message || '');
  return error?.name === 'AbortError' || /aborted|timed out|timeout|fetch failed|network|socket/i.test(message);
}

function sourceGroupForType(type) {
  if (STOCK_TYPE_GROUPS.stock.includes(type)) return 'stock';
  if (STOCK_TYPE_GROUPS.weather.includes(type)) return 'weather';
  if (type === 'sell') return 'sell';
  return String(type || 'unknown');
}

function sourceErrorSummary(error) {
  const status = Number(error?.status);
  if (Number.isFinite(status) && status > 0) return `HTTP ${status}`;
  return String(error?.message || 'unknown source error')
    .replace(/https?:\/\/\S+/gi, 'source')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function resetUnavailableFailures(state, target, nowMs) {
  const bucket = state.unavailable?.[target.guildId]?.[target.type];
  if (!bucket?.consecutiveFailures) return false;
  bucket.consecutiveFailures = 0;
  bucket.lastRecoveredAt = new Date(nowMs).toISOString();
  return true;
}

function roleColor(spec) {
  return Number.isInteger(spec?.color) ? spec.color : undefined;
}

async function updateRoleColorIfNeeded(role, spec, guildId) {
  const color = roleColor(spec);
  if (!Number.isInteger(color) || !role || role.color === color || role.editable === false || typeof role.edit !== 'function') return;
  await role.edit({
    colors: { primaryColor: color },
    reason: 'CoinSprite GAG2 notification role color sync',
  }).catch((error) => {
    logCommandSystem(`GAG2 role color update failed in guild ${guildId} (${spec.roleName}): ${error?.message || 'unknown error'}`);
  });
}

function selectedFilterValues(filters, path, fallback) {
  const value = path.reduce((current, key) => current?.[key], filters);
  return new Set(Array.isArray(value) ? value : fallback);
}

function sellFilterBucket(entry) {
  return sellMultiplierBucket(entry?.multiplier) || 'normal';
}

function filterSellEntry(entry, filters = {}) {
  const rarities = selectedFilterValues(filters, ['rarities', 'sell'], GAG2_SELL_FILTER_RARITIES);
  const multipliers = selectedFilterValues(filters, ['sellMultipliers'], GAG2_SELL_MULTIPLIERS);
  const includeUnknownRarity = rarities.size === GAG2_SELL_FILTER_RARITIES.length;
  const entries = (entry?.entries || []).filter((item) => {
    const rarity = normalizeRarity(rarityForType('sell', item));
    return multipliers.has(sellFilterBucket(item)) && (rarities.has(rarity) || (!rarity && includeUnknownRarity));
  });
  return {
    ...entry,
    entries,
    enabledMultipliers: [...multipliers],
  };
}

function filteredRoleSpecs(type, specs, filters = {}) {
  if (['seed', 'gear', 'crate'].includes(type)) {
    const selected = selectedFilterValues(filters, ['rarities', type], GAG2_ROLE_FILTER_RARITIES);
    return specs.filter((spec) => !GAG2_ROLE_FILTER_RARITIES.includes(spec.rarity) || selected.has(spec.rarity));
  }
  if (type === 'sell') {
    const rarities = selectedFilterValues(filters, ['rarities', 'sell'], GAG2_SELL_FILTER_RARITIES);
    const multipliers = selectedFilterValues(filters, ['sellMultipliers'], GAG2_SELL_MULTIPLIERS);
    return specs.filter((spec) => rarities.has(spec.rarity) && multipliers.has(spec.bucket));
  }
  return specs;
}

async function roleSpecsForTypes(types, filters = {}) {
  const specsByType = Object.fromEntries(STOCK_TYPES.map((type) => [type, []]));
  for (const type of types) specsByType[type] = filteredRoleSpecs(type, roleSpecsForType(type), filters);
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
  const failedRoleIds = new Set();
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
      failedRoleIds.add(roleId);
    }
  }

  for (const type of disabled) {
    const currentRoleIds = { ...(config?.gag2Stock?.roleIds?.[type] || {}) };
    if (!Object.keys(currentRoleIds).length) continue;
    const roleIds = Object.fromEntries(Object.entries(currentRoleIds)
      .filter(([, roleId]) => failedRoleIds.has(roleId)));
    updateGuildGag2StockRoleIds(guild.id, type, roleIds);
  }
  return { removed, failed, total };
}

async function clearFilteredTypeRoles(guild, config, enabledTypes, specsByType, roles, progress) {
  const desiredKeys = Object.fromEntries(enabledTypes.map((type) => [
    type,
    new Set((specsByType[type] || []).map((spec) => spec.key)),
  ]));
  const protectedRoleIds = new Set();
  for (const type of enabledTypes) {
    for (const [key, roleId] of Object.entries(config?.gag2Stock?.roleIds?.[type] || {})) {
      if (desiredKeys[type].has(key) && roleId) protectedRoleIds.add(roleId);
    }
  }

  const deleteCandidates = new Map();
  for (const type of enabledTypes) {
    for (const [key, roleId] of Object.entries(config?.gag2Stock?.roleIds?.[type] || {})) {
      if (desiredKeys[type].has(key) || protectedRoleIds.has(roleId) || deleteCandidates.has(roleId)) continue;
      const role = roles.get(roleId);
      if (role && typeof role.delete === 'function') deleteCandidates.set(roleId, role);
    }
  }

  let remaining = deleteCandidates.size;
  const total = remaining;
  let removed = 0;
  let failed = 0;
  const failedRoleIds = new Set();
  if (remaining) progress?.({ action: 'removing', remaining, total, status: 'running', message: `Removing ${remaining} roles` });
  for (const [roleId, role] of deleteCandidates) {
    const deleted = await role.delete('CoinSprite GAG2 rarity or multiplier filter disabled').then(() => true).catch((error) => {
      logCommandSystem(`GAG2 filtered role delete failed in guild ${guild.id} (${role.name || roleId}): ${error?.message || 'unknown error'}`);
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
      failedRoleIds.add(roleId);
    }
  }

  for (const type of enabledTypes) {
    const roleIds = Object.fromEntries(Object.entries(config?.gag2Stock?.roleIds?.[type] || {})
      .filter(([key, roleId]) => desiredKeys[type].has(key) || failedRoleIds.has(roleId)));
    updateGuildGag2StockRoleIds(guild.id, type, roleIds);
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
    this.checkScheduleSecondMs = options.checkScheduleSecondMs ?? CHECK_SCHEDULE_SECOND_MS;
    this.checkScheduleOffsetMs = options.checkScheduleOffsetMs ?? CHECK_SCHEDULE_UTC_OFFSET_MS;
    const stockInitialDelay = Number(options.stockInitialDelayMs ?? options.initialDelayMs);
    const weatherInterval = Number(options.weatherCheckIntervalMs);
    const weatherInitialDelay = Number(options.weatherInitialDelayMs);
    const sellInitialDelay = Number(options.sellInitialDelayMs);
    const sellInterval = Number(options.sellCheckIntervalMs);
    const sellScheduleSecond = Number(options.sellCheckScheduleSecondMs);
    this.stockInitialDelayMs = Math.max(0, Number.isFinite(stockInitialDelay) ? stockInitialDelay : 1_000);
    this.weatherCheckIntervalMs = Math.max(5_000, Number.isFinite(weatherInterval) ? weatherInterval : WEATHER_CHECK_INTERVAL_MS);
    this.weatherInitialDelayMs = Math.max(0, Number.isFinite(weatherInitialDelay) ? weatherInitialDelay : 1_000);
    this.sellInitialDelayMs = Math.max(0, Number.isFinite(sellInitialDelay) ? sellInitialDelay : 1_000);
    this.sellCheckIntervalMs = Math.max(60_000, Number.isFinite(sellInterval) ? sellInterval : SELL_CHECK_INTERVAL_MS);
    this.sellCheckScheduleSecondMs = Math.max(0, Math.min(this.sellCheckIntervalMs - 1, Number.isFinite(sellScheduleSecond) ? sellScheduleSecond : SELL_CHECK_SCHEDULE_SECOND_MS));
    this.sellUnchangedRetryMs = Math.max(1_000, Number(options.sellUnchangedRetryMs) || SELL_UNCHANGED_RETRY_MS);
    this.staleStockRetryMs = Math.max(1_000, Number(options.staleStockRetryMs) || STALE_STOCK_RETRY_MS);
    this.fetchers = {
      fetchItemsPayload: options.fetchItemsPayload || fetchItemsPayload,
      fetchSellPayload: options.fetchSellPayload || fetchSellPayload,
      fetchStockPayload: options.fetchStockPayload || fetchStockPayload,
      fetchWeatherPayload: options.fetchWeatherPayload || fetchWeatherPayload,
    };
    this.now = options.now || (() => Date.now());
    this.statePath = options.statePath || STATE_PATH;
    this.transientUnavailableNoticeFailures = Math.max(1, Number(options.transientUnavailableNoticeFailures) || TRANSIENT_UNAVAILABLE_NOTICE_FAILURES);
    this.sourceFailureLogIntervalMs = Math.max(5_000, Number(options.sourceFailureLogIntervalMs) || SOURCE_FAILURE_LOG_INTERVAL_MS);
    this.logSystem = options.logSystem || logCommandSystem;
    this.postPermissionCheckLimit = Math.max(1, Number(options.postPermissionCheckLimit) || POST_PERMISSION_CHECK_LIMIT);
    this.postPermissionRetryMs = Math.max(1_000, Number(options.postPermissionRetryMs) || POST_PERMISSION_RETRY_MS);
    this.broadcastConcurrency = normalizeConcurrency(
      options.broadcastConcurrency,
      DEFAULT_GAG2_BROADCAST_CONCURRENCY,
    );
    this.inFlight = new Set();
    this.deliveryInFlight = new Map();
    this.postPermissionFailures = new Map();
    this.sourceHealth = new Map();
    this.timer = null;
    this.weatherTimer = null;
    this.sellTimer = null;
    this.started = false;
    this.nextStockRefreshAtMs = null;
    this.nextSellRefreshAtMs = null;
    this.nextDelayOverrideMs = null;
    this.nextSellDelayOverrideMs = null;
  }

  async start() {
    if (this.started) return this;
    this.started = true;
    this.scheduleNextTick(this.stockInitialDelayMs);
    this.scheduleWeatherTick(this.weatherInitialDelayMs);
    this.scheduleSellTick(this.sellInitialDelayMs);
    setTimeout(() => {
      syncAllGag2StockSetups(this.client, this.fetchers)
        .then(() => syncAllGag2RoleAssignmentPanels(this.client))
        .catch((error) => {
          logCommandSystem(`GAG2 startup sync failed: ${error?.message || 'unknown error'}`);
        });
    }, 5_000).unref?.();
    return this;
  }

  scheduleNextTick(delayOverrideMs = null) {
    if (!this.started) return null;
    const now = this.now();
    const override = Number.isFinite(this.nextDelayOverrideMs) ? Math.max(0, this.nextDelayOverrideMs) : delayOverrideMs;
    this.nextDelayOverrideMs = null;
    const hasOverride = override !== null && override !== undefined && Number.isFinite(Number(override));
    const apiNextAt = Number.isFinite(this.nextStockRefreshAtMs) && this.nextStockRefreshAtMs > now
      ? this.nextStockRefreshAtMs
      : null;
    const nextAt = hasOverride
      ? now + Math.max(0, Number(override))
      : apiNextAt
        || nextGag2StockTickAtMs(now, {
          intervalMs: this.checkIntervalMs,
          secondMs: this.checkScheduleSecondMs,
          offsetMs: this.checkScheduleOffsetMs,
        });
    const delay = Math.max(0, nextAt - now);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick(STOCK_POST_TYPES, 'stock')
        .catch((error) => {
          logCommandSystem(`GAG2 stock tick failed: ${error?.message || 'unknown error'}`);
        })
        .finally(() => {
          this.scheduleNextTick();
        });
    }, delay);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return nextAt;
  }

  scheduleWeatherTick(delayOverrideMs = null) {
    if (!this.started) return null;
    const now = this.now();
    const override = Number(delayOverrideMs);
    const delay = Math.max(0, delayOverrideMs !== null && Number.isFinite(override) ? override : this.weatherCheckIntervalMs);
    const nextAt = now + delay;
    this.weatherTimer = setTimeout(() => {
      this.weatherTimer = null;
      this.tick(WEATHER_POST_TYPES, 'weather')
        .catch((error) => {
          logCommandSystem(`GAG2 weather tick failed: ${error?.message || 'unknown error'}`);
        })
        .finally(() => {
          this.scheduleWeatherTick();
        });
    }, delay);
    if (typeof this.weatherTimer.unref === 'function') this.weatherTimer.unref();
    return nextAt;
  }

  scheduleSellTick(delayOverrideMs = null) {
    if (!this.started) return null;
    const now = this.now();
    const override = Number.isFinite(this.nextSellDelayOverrideMs)
      ? Math.max(0, this.nextSellDelayOverrideMs)
      : delayOverrideMs;
    this.nextSellDelayOverrideMs = null;
    const hasOverride = override !== null && override !== undefined && Number.isFinite(Number(override));
    const apiNextAt = Number.isFinite(this.nextSellRefreshAtMs) && this.nextSellRefreshAtMs > now
      ? this.nextSellRefreshAtMs
      : null;
    const nextAt = hasOverride
      ? now + Math.max(0, Number(override))
      : apiNextAt
        || nextGag2StockTickAtMs(now, {
          intervalMs: this.sellCheckIntervalMs,
          secondMs: this.sellCheckScheduleSecondMs,
          offsetMs: this.checkScheduleOffsetMs,
        });
    const delay = Math.max(0, nextAt - now);
    this.sellTimer = setTimeout(() => {
      this.sellTimer = null;
      this.tick(SELL_POST_TYPES, 'sell')
        .catch((error) => {
          logCommandSystem(`GAG2 sell tick failed: ${error?.message || 'unknown error'}`);
        })
        .finally(() => {
          this.scheduleSellTick();
        });
    }, delay);
    if (typeof this.sellTimer.unref === 'function') this.sellTimer.unref();
    return nextAt;
  }

  stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.weatherTimer) clearTimeout(this.weatherTimer);
    if (this.sellTimer) clearTimeout(this.sellTimer);
    this.timer = null;
    this.weatherTimer = null;
    this.sellTimer = null;
  }

  updateSourceHealth(targets, errors) {
    const groups = new Map();
    for (const target of targets) {
      const group = sourceGroupForType(target.type);
      const current = groups.get(group) || { targetCount: 0, error: null };
      current.targetCount += 1;
      current.error ||= errors.get(target.type) || null;
      groups.set(group, current);
    }

    const nowMs = this.now();
    for (const [group, status] of groups) {
      const previous = this.sourceHealth.get(group);
      if (!status.error) {
        if (previous?.consecutiveFailures) {
          this.logSystem(`GAG2 ${group} source recovered after ${previous.consecutiveFailures} failed poll${previous.consecutiveFailures === 1 ? '' : 's'}.`);
        }
        this.sourceHealth.delete(group);
        continue;
      }

      const health = previous || { consecutiveFailures: 0, lastLoggedAtMs: 0 };
      health.consecutiveFailures += 1;
      const shouldLog = health.consecutiveFailures === 1
        || nowMs - health.lastLoggedAtMs >= this.sourceFailureLogIntervalMs;
      if (shouldLog) {
        const attempts = Math.max(1, Number(status.error?.attempts) || 1);
        this.logSystem(
          `GAG2 ${group} source temporarily unavailable (${sourceErrorSummary(status.error)}; ${attempts} request attempt${attempts === 1 ? '' : 's'}). `
          + `Leaving ${status.targetCount} configured destination${status.targetCount === 1 ? '' : 's'} unchanged; retrying on the next poll.`,
        );
        health.lastLoggedAtMs = nowMs;
      }
      this.sourceHealth.set(group, health);
    }
  }

  postPermissionFailureKey(target) {
    return `${target.guildId}:${target.type}:${target.channelId}`;
  }

  postPermissionStopped(target, postKey) {
    const record = this.postPermissionFailures.get(this.postPermissionFailureKey(target));
    return record?.postKey === postKey && record.checks >= this.postPermissionCheckLimit;
  }

  schedulePostPermissionRetry(target) {
    if (STOCK_TYPE_GROUPS.stock.includes(target.type)) {
      this.nextDelayOverrideMs = Number.isFinite(this.nextDelayOverrideMs)
        ? Math.min(this.nextDelayOverrideMs, this.postPermissionRetryMs)
        : this.postPermissionRetryMs;
    } else if (target.type === 'sell') {
      this.nextSellDelayOverrideMs = Number.isFinite(this.nextSellDelayOverrideMs)
        ? Math.min(this.nextSellDelayOverrideMs, this.postPermissionRetryMs)
        : this.postPermissionRetryMs;
    }
  }

  async postPermissionDiagnostic(channel, target, options = {}) {
    const guild = channel?.guild
      || this.client?.guilds?.cache?.get?.(target.guildId)
      || await this.client?.guilds?.fetch?.(target.guildId).catch(() => null);
    const member = guild?.members?.me || await guild?.members?.fetchMe?.().catch(() => null) || this.client?.user;
    return diagnosePostPermissions(channel, member, target.type, options);
  }

  recordPostPermissionFailure(target, postKey, diagnostic, channel = null) {
    const key = this.postPermissionFailureKey(target);
    const previous = this.postPermissionFailures.get(key);
    const record = previous?.postKey === postKey
      ? previous
      : { postKey, checks: 0 };
    if (record.checks >= this.postPermissionCheckLimit) return null;
    record.checks += 1;
    this.postPermissionFailures.set(key, record);

    const channelName = String(channel?.name || '').trim();
    const location = channelName ? `#${channelName} (${target.channelId})` : `channel ${target.channelId}`;
    const guildName = String(channel?.guild?.name || '').trim();
    const guildLocation = guildName ? `${guildName} (${target.guildId})` : target.guildId;
    const details = [];
    if (diagnostic?.server?.length) details.push(`Missing server role permissions: ${diagnostic.server.join(', ')}`);
    if (diagnostic?.channel?.length) details.push(`Missing channel/category permissions in ${location}: ${diagnostic.channel.join(', ')}`);
    if (diagnostic?.unknown?.length) details.push(diagnostic.unknown.join(', '));
    if (!details.length) details.push('Discord returned Missing Permissions (50013)');
    const stopped = record.checks >= this.postPermissionCheckLimit;
    const nextAction = stopped
      ? `Stopping only this ${target.type} announcement after ${record.checks} checks; the next stock/event gets a fresh ${this.postPermissionCheckLimit} checks.`
      : `Retrying this announcement in ${Math.round(this.postPermissionRetryMs / 1_000)} seconds.`;
    this.logSystem(
      `GAG2 ${target.type} permission check ${record.checks}/${this.postPermissionCheckLimit} failed for guild ${guildLocation}. `
      + `${details.join('. ')}. ${nextAction}`,
    );
    if (!stopped) this.schedulePostPermissionRetry(target);
    return null;
  }

  clearPostPermissionFailure(target, postKey, channel = null) {
    const key = this.postPermissionFailureKey(target);
    const record = this.postPermissionFailures.get(key);
    if (!record) return;
    this.postPermissionFailures.delete(key);
    if (record.postKey !== postKey || !record.checks) return;
    const channelName = String(channel?.name || '').trim();
    const location = channelName ? `#${channelName} (${target.channelId})` : `channel ${target.channelId}`;
    const guildName = String(channel?.guild?.name || '').trim();
    const guildLocation = guildName ? `${guildName} (${target.guildId})` : target.guildId;
    this.logSystem(`GAG2 ${target.type} posting permissions restored for guild ${guildLocation} in ${location}.`);
  }

  targets(types = STOCK_TYPES) {
    const allowedTypes = new Set(types);
    const targets = [];
    for (const guildId of getEnabledGuildIds()) {
      if (!isGuildGag2StockEnabled(guildId)) continue;
      const config = getGuildConfig(guildId);
      const channels = config?.gag2Stock?.channels || {};
      for (const type of STOCK_TYPES) {
        if (!allowedTypes.has(type)) continue;
        const channelId = cleanChannelId(channels[type]);
        if (!channelId) continue;
        targets.push({
          guildId,
          type,
          channelId,
          roleIds: config?.gag2Stock?.roleIds?.[type] || {},
          filters: config?.gag2Stock?.filters || {},
        });
      }
    }
    return targets;
  }

  async tick(types = STOCK_TYPES, label = 'stock') {
    const tickTypes = Array.isArray(types) && types.length ? types : STOCK_TYPES;
    const lockKey = [...tickTypes].sort().join(',');
    if (this.inFlight.has(lockKey)) return null;
    this.inFlight.add(lockKey);
    let skippedStaleStock = false;

    try {
      const tickStartedAtMs = this.now();
      const targets = this.targets(tickTypes);
      if (!targets.length) return null;
      const state = loadState(this.statePath);
      const { entries, errors } = await fetchEntriesForTargets(targets, this.fetchers);
      this.updateSourceHealth(targets, errors);
      const targetTypes = [...new Set(targets.map((target) => target.type))];
      const nextStockRefreshAtMs = nextApiRefreshAtMsForTypes(
        entries,
        targetTypes.filter((type) => STOCK_TYPE_GROUPS.stock.includes(type)),
        tickStartedAtMs,
      );
      const nextSellRefreshAtMs = nextApiRefreshAtMsForTypes(entries, targetTypes.filter((type) => type === 'sell'), tickStartedAtMs);
      if (Number.isFinite(nextStockRefreshAtMs)) this.nextStockRefreshAtMs = nextStockRefreshAtMs;
      if (Number.isFinite(nextSellRefreshAtMs)) this.nextSellRefreshAtMs = nextSellRefreshAtMs;
      const deliveries = await mapWithConcurrency(targets, this.broadcastConcurrency, async (target) => {
        const error = errors.get(target.type);
        if (error) {
          const message = await this.postUnavailableOnce(state, target, error).catch((postError) => {
            logCommandSystem(`GAG2 ${target.type} unavailable notice failed: ${postError?.message || 'unknown error'}`);
            return null;
          });
          return message;
        }

        let entry = entries.get(target.type);
        if (!entry) return null;
        if (target.type === 'sell') {
          entry = filterSellEntry(entry, target.filters);
          if (!entry.entries.length) return null;
          if (isApiRefreshDue(target.type, entry, tickStartedAtMs)) {
            this.nextSellDelayOverrideMs = this.sellUnchangedRetryMs;
            return null;
          }
        }
        if (resetUnavailableFailures(state, target, tickStartedAtMs)) saveState(state, this.statePath);
        if (isStaleStockEntry(target.type, entry, tickStartedAtMs)) {
          skippedStaleStock = true;
          return null;
        }
        return this.postEntry(state, target, entry).catch((postError) => {
          logCommandSystem(`GAG2 ${target.type} post failed in guild ${target.guildId}: ${postError?.message || 'unknown error'}`);
          return null;
        });
      });
      return deliveries.filter(Boolean);
    } catch (error) {
      logCommandSystem(`GAG2 ${label} failed: ${error?.message || 'unknown error'}`);
      return null;
    } finally {
      if (skippedStaleStock) this.nextDelayOverrideMs = this.staleStockRetryMs;
      this.inFlight.delete(lockKey);
    }
  }

  async postEntry(state, target, entry) {
    const deliveryKey = `${target.type}:${target.channelId}`;
    const previous = this.deliveryInFlight.get(deliveryKey);
    const delivery = (previous ? previous.catch(() => null) : Promise.resolve())
      .then(() => this.postEntryLocked(state, target, entry));
    this.deliveryInFlight.set(deliveryKey, delivery);
    try {
      return await delivery;
    } finally {
      if (this.deliveryInFlight.get(deliveryKey) === delivery) this.deliveryInFlight.delete(deliveryKey);
    }
  }

  async postEntryLocked(state, target, entry) {
    const bucket = postBucket(state, target.guildId, target.type);
    const postKey = buildTypePostKey(target.type, entry);
    if (target.type === 'sell') {
      if (sellEntryIsOlderThanBucket(bucket, entry)) {
        logCommandSystem(`GAG2 sell stale snapshot suppressed in ${target.channelId}: ${postKey}`);
        return null;
      }
      if (sellEntryIsSameOrOlderCycle(bucket, entry) && recentSellPostKeys(bucket).includes(postKey)) {
        logCommandSystem(`GAG2 sell replay suppressed in ${target.channelId}: ${postKey}`);
        return null;
      }
    }
    const samePost = bucket.lastPostedKey === postKey && bucket.channelId === target.channelId;
    if (samePost && target.type !== 'moon') {
      if (target.type === 'sell' && isApiRefreshDue(target.type, entry, this.now())) {
        this.nextSellDelayOverrideMs = this.sellUnchangedRetryMs;
      }
      return null;
    }

    if (this.postPermissionStopped(target, postKey)) return null;
    const channel = await getSendableChannel(this.client, target.channelId);
    if (!channel) {
      return this.recordPostPermissionFailure(target, postKey, {
        server: [],
        channel: ['View Channel'],
        unknown: ['The channel may also have been deleted or changed'],
      });
    }
    const permissionDiagnostic = await this.postPermissionDiagnostic(channel, target);
    if (hasMissingPostPermissions(permissionDiagnostic)) {
      return this.recordPostPermissionFailure(target, postKey, permissionDiagnostic, channel);
    }

    const payload = buildTypePayload(target.type, entry, { roleIds: target.roleIds });
    if (target.type === 'sell' && (!bucket.lastPostedKey || sellEntryIsSameOrOlderCycle(bucket, entry))) {
      const existing = await findMatchingRecentBotMessage(channel, this.client?.user?.id, payload, this.now());
      if (existing) {
        if (!bucket.lastPostedKey) {
          Object.assign(bucket, {
            channelId: target.channelId,
            lastMessageId: existing.id || null,
            lastPostedAt: new Date(Number(existing.createdTimestamp) || this.now()).toISOString(),
            lastPostedKey: postKey,
          });
          updateSellPostMetadata(bucket, entry);
        } else {
          rememberSellPostKey(bucket, postKey);
        }
        saveState(state, this.statePath);
        this.clearPostPermissionFailure(target, postKey, channel);
        logCommandSystem(`GAG2 sell recent duplicate suppressed in ${target.channelId}: ${postKey}`);
        return null;
      }
    }
    let message = null;
    let editPermissionFailure = false;
    if (target.type === 'moon' && bucket.lastMessageId) {
      const existing = await channel.messages?.fetch?.(bucket.lastMessageId).catch(() => null);
      if (samePost && existing) {
        this.clearPostPermissionFailure(target, postKey, channel);
        return null;
      }
      message = await existing?.edit?.(payload).catch((error) => {
        if (isDiscordMissingPermissionsError(error)) {
          editPermissionFailure = true;
          const diagnostic = hasMissingPostPermissions(permissionDiagnostic)
            ? permissionDiagnostic
            : { server: [], channel: [], unknown: ['Discord returned Missing Permissions while editing the message (50013)'] };
          this.recordPostPermissionFailure(target, postKey, diagnostic, channel);
          return null;
        }
        logCommandSystem(`GAG2 moon prediction edit failed in guild ${target.guildId}: ${error?.message || 'unknown error'}`);
        return null;
      });
    }
    if (editPermissionFailure) return null;
    if (!message) {
      try {
        message = await channel.send(payload);
      } catch (error) {
        if (isDiscordMissingPermissionsError(error)) {
          const diagnostic = await this.postPermissionDiagnostic(channel, target);
          if (!hasMissingPostPermissions(diagnostic)) {
            diagnostic.unknown = ['Discord returned Missing Permissions while sending the message (50013)'];
          }
          return this.recordPostPermissionFailure(target, postKey, diagnostic, channel);
        }
        throw error;
      }
    }
    if (target.type === 'sell' && bucket.lastPostedKey && bucket.lastPostedKey !== postKey) {
      rememberSellPostKey(bucket, bucket.lastPostedKey);
    }
    if (target.type === 'sell' && Array.isArray(bucket.recentPostedKeys)) {
      bucket.recentPostedKeys = bucket.recentPostedKeys.filter((key) => key !== postKey);
    }
    Object.assign(bucket, {
      channelId: target.channelId,
      lastMessageId: message?.id || null,
      lastPostedAt: new Date(this.now()).toISOString(),
      lastPostedKey: postKey,
    });
    if (target.type === 'sell') updateSellPostMetadata(bucket, entry);
    saveState(state, this.statePath);
    this.clearPostPermissionFailure(target, postKey, channel);
    logCommandSystem(`GAG2 ${target.type} posted to ${target.channelId}: ${postKey}`);
    return message;
  }

  async postUnavailableOnce(state, target, error) {
    const bucket = unavailableBucket(state, target.guildId, target.type);
    bucket.consecutiveFailures = (Number(bucket.consecutiveFailures) || 0) + 1;
    bucket.lastErrorAt = new Date(this.now()).toISOString();
    bucket.lastErrorMessage = String(error?.message || 'Unknown error').slice(0, 500);

    const hasPreviousGoodPost = Boolean(existingPostBucket(state, target.guildId, target.type)?.lastPostedKey);
    const transient = isTransientSourceError(error);
    const waitingForInitialSource = transient && bucket.consecutiveFailures < this.transientUnavailableNoticeFailures;
    if (transient && (hasPreviousGoodPost || waitingForInitialSource)) {
      saveState(state, this.statePath);
      return null;
    }

    const dayBucket = new Date(this.now()).toISOString().slice(0, 10);
    const postKey = `unavailable:${target.channelId}:${dayBucket}`;
    if (bucket.lastPostedKey === postKey) {
      saveState(state, this.statePath);
      return null;
    }

    if (this.postPermissionStopped(target, postKey)) return null;
    const channel = await getSendableChannel(this.client, target.channelId);
    if (!channel) {
      return this.recordPostPermissionFailure(target, postKey, {
        server: [],
        channel: ['View Channel'],
        unknown: ['The channel may also have been deleted or changed'],
      });
    }
    const permissionDiagnostic = await this.postPermissionDiagnostic(channel, target, {
      requireHistory: false,
      useExternalEmojis: false,
    });
    if (hasMissingPostPermissions(permissionDiagnostic)) {
      return this.recordPostPermissionFailure(target, postKey, permissionDiagnostic, channel);
    }
    let message = null;
    try {
      message = await channel.send(buildUnavailablePayload(target.type, error?.message || 'Unknown error', this.now()));
    } catch (postError) {
      if (isDiscordMissingPermissionsError(postError)) {
        const diagnostic = await this.postPermissionDiagnostic(channel, target, {
          requireHistory: false,
          useExternalEmojis: false,
        });
        if (!hasMissingPostPermissions(diagnostic)) {
          diagnostic.unknown = ['Discord returned Missing Permissions while sending the message (50013)'];
        }
        return this.recordPostPermissionFailure(target, postKey, diagnostic, channel);
      }
      throw postError;
    }
    Object.assign(bucket, {
      channelId: target.channelId,
      lastMessageId: message?.id || null,
      lastPostedAt: new Date(this.now()).toISOString(),
      lastPostedKey: postKey,
    });
    saveState(state, this.statePath);
    this.clearPostPermissionFailure(target, postKey, channel);
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
  const specsByType = await roleSpecsForTypes(enabledTypes, config?.gag2Stock?.filters || {});
  const disabledRemoval = await clearDisabledTypeRoles(guild, config, enabledTypes, roles, progress);
  if (!enabledTypes.length) {
    if (!disabledRemoval.failed) progressGuildId && progress({ action: disabledRemoval.removed ? 'removing' : 'checking', remaining: 0, total: disabledRemoval.removed, status: 'done', message: disabledRemoval.removed ? 'Removed roles' : 'No roles needed' });
    return { removed: disabledRemoval.removed, failed: disabledRemoval.failed, added: 0 };
  }

  const filteredRemoval = await clearFilteredTypeRoles(guild, config, enabledTypes, specsByType, roles, progress);
  const removal = {
    removed: disabledRemoval.removed + filteredRemoval.removed,
    failed: disabledRemoval.failed + filteredRemoval.failed,
  };
  const syncedConfig = getGuildConfig(guild.id);
  const byName = new Map([...roles.values()].map((role) => [role.name.toLowerCase(), role]));
  const result = {};
  let addRemaining = 0;
  for (const type of enabledTypes) {
    const roleIds = { ...(syncedConfig?.gag2Stock?.roleIds?.[type] || {}) };
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
    const roleIds = { ...(syncedConfig?.gag2Stock?.roleIds?.[type] || {}) };
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
        if (Number.isInteger(color)) createOptions.colors = { primaryColor: color };
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

  const failed = removal.failed + addRemaining;
  if (progressGuildId) {
    const action = addTotal ? 'adding' : removal.removed ? 'removing' : 'checking';
    const total = addTotal || removal.removed;
    if (failed) {
      progress({ action, remaining: failed, total, status: 'error', message: `Could not apply ${failed} role change${failed === 1 ? '' : 's'}` });
    } else {
      progress({ action, remaining: 0, total, status: 'done', message: addTotal || removal.removed ? 'Role changes applied' : 'Roles already synced' });
    }
  }
  return { ...result, added: addTotal - addRemaining, removed: removal.removed, failed };
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
  componentFingerprint,
  diagnosePostPermissions,
  filterSellEntry,
  findMatchingRecentBotMessage,
  filteredRoleSpecs,
  getGag2StockSetupProgress,
  isStaleStockEntry,
  nextGag2StockTickAtMs,
  roleSpecsForTypes,
  startGag2StockPoster,
  syncAllGag2StockSetups,
  syncGag2StockGuildSetup,
};
