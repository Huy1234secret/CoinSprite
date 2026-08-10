const { PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('../commandLogger');
const {
  GAG2_FALL_STOCK_TYPES,
  GAG2_ROLE_FILTER_RARITIES,
  GAG2_SELL_FILTER_RARITIES,
  GAG2_SELL_MULTIPLIERS,
  getConfiguredGuildIds,
  getEnabledGuildIds,
  getGuildConfig,
  getGuildConfigRaw,
  isGuildGag2StockEnabled,
  updateGuildGag2StockRoleIds,
} = require('../serverConfig');
const {
  CHECK_INTERVAL_MS,
  CHECK_SCHEDULE_SECOND_MS,
  CHECK_SCHEDULE_UTC_OFFSET_MS,
  isFallHarvestActive,
  SELL_CHECK_INTERVAL_MS,
  SELL_CHECK_SCHEDULE_SECOND_MS,
  SELL_FAILURE_RETRY_LIMIT,
  SELL_UNCHANGED_RETRY_MS,
  STATE_PATH,
  STOCK_FAILURE_RETRY_LIMIT,
  STOCK_FAILURE_RETRY_MS,
  STOCK_TYPE_GROUPS,
  STOCK_TYPES,
  WEATHER_CHECK_INTERVAL_MS,
} = require('./config');
const {
  fetchFallSellPayload,
  fetchFallStockPayload,
  fetchSellPayload,
  fetchStockPayload,
  fetchWeatherPayload,
} = require('./source');
const {
  buildTypePayloads,
  buildTypePostKey,
} = require('./stockPayload');
const {
  FALL_ROLE_TYPES,
  fallRoleTypeForStock,
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
const ROLE_TYPES = Object.freeze([...STOCK_TYPES, ...Object.values(FALL_ROLE_TYPES)]);
const RECENT_SELL_DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const RECENT_STOCK_DEDUPE_WINDOW_MS = 15 * 60 * 1000;
const RECENT_SELL_POST_KEY_LIMIT = 24;
const RECENT_UNAVAILABLE_CLEANUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const SELL_RECONCILIATION_MAX_RETRIES = 3;
const SELL_RECONCILIATION_BACKOFF_MS = 1500;

const POST_PERMISSION_LABELS = Object.freeze([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.SendMessagesInThreads, 'Send Messages in Threads'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
  [PermissionFlagsBits.UseExternalEmojis, 'Use External Emojis'],
]);

function activeFallTypes(config, nowMs = Date.now()) {
  return isFallHarvestActive(nowMs)
    ? new Set(config?.gag2Stock?.fall?.enabledTypes || [])
    : new Set();
}

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
  if (options.requireHistory !== false && (STOCK_TYPE_GROUPS.stock.includes(type) || type === 'moon' || type === 'sell')) {
    flags.push(PermissionFlagsBits.ReadMessageHistory);
  }
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

function currentGag2StockCycleAtMs(nowMs = Date.now(), options = {}) {
  const intervalMs = Math.max(1_000, finiteNumber(options.intervalMs, CHECK_INTERVAL_MS));
  const offsetMs = finiteNumber(options.offsetMs, CHECK_SCHEDULE_UTC_OFFSET_MS);
  const shiftedNow = finiteNumber(nowMs, Date.now()) + offsetMs;
  return Math.floor(shiftedNow / intervalMs) * intervalMs - offsetMs;
}

function isInactiveWeatherEntry(entry, nowMs = Date.now()) {
  const current = entry?.current;
  if (!current) return true;
  const now = finiteNumber(nowMs, Date.now());
  const startsAtMs = timestampMs(current.startsAtMs);
  const endsAtMs = timestampMs(current.endsAtMs);
  if (startsAtMs !== null && startsAtMs > now) return true;
  return endsAtMs !== null && endsAtMs <= now;
}

function apiRefreshAtMsForEntry(type, entry) {
  if (STOCK_TYPE_GROUPS.stock.includes(type)) return Number(entry?.nextRestockAtMs);
  if (type === 'sell') return Number(entry?.nextRefreshAtMs);
  return null;
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
  if (Number.isInteger(raw.style)) component.style = raw.style;
  if (typeof raw.label === 'string') component.label = raw.label;
  if (typeof raw.url === 'string') component.url = raw.url;
  const customId = raw.custom_id ?? raw.customId;
  if (typeof customId === 'string') component.custom_id = customId;
  if (raw.emoji) {
    const emoji = {};
    if (raw.emoji.name) emoji.name = raw.emoji.name;
    if (raw.emoji.id) emoji.id = String(raw.emoji.id);
    if (Object.keys(emoji).length) component.emoji = emoji;
  }
  if (raw.divider === true) component.divider = true;
  if (Number.isInteger(raw.spacing)) component.spacing = raw.spacing;
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

function sellMessageNextRefreshAtMs(message) {
  const text = (Array.isArray(message?.components) ? message.components : [])
    .map(componentText)
    .join('\n');
  const match = text.match(/\b(?:Refresh|Sell cycle)\s+(?:·\s*)?(?:Refresh\s+)?<t:(\d+):[A-Za-z]>/i);
  return match ? Number(match[1]) * 1000 : null;
}

function findMatchingRecentSellMessages(channel, clientUserId, expectedRefreshAtMs, fingerprint, nowMs = Date.now()) {
  if (typeof channel?.messages?.fetch !== 'function') return Promise.resolve([]);
  return channel.messages.fetch({ limit: 25 }).catch(() => null).then((messages) => {
    if (!messages || typeof messages.values !== 'function') return [];
    const result = [];
    for (const message of messages.values()) {
      const ownMessage = clientUserId
        ? message?.author?.id === clientUserId
        : message?.author?.bot === true;
      if (!ownMessage) continue;
      const createdAtMs = messageCreatedAtMs(message);
      if (createdAtMs && createdAtMs < nowMs - RECENT_SELL_DEDUPE_WINDOW_MS) continue;
      const refreshAtMs = sellMessageNextRefreshAtMs(message);
      if (expectedRefreshAtMs !== null && refreshAtMs !== expectedRefreshAtMs) continue;
      if (componentFingerprint(message?.components) !== fingerprint) continue;
      result.push({ message, refreshAtMs, createdAtMs });
    }
    return result.sort((left, right) => left.createdAtMs - right.createdAtMs
      || String(left.message?.id || '').localeCompare(String(right.message?.id || '')));
  });
}

function stockNextRestockAtMs(entry) {
  const nextAtMs = timestampMs(entry?.nextRestockAtMs);
  if (nextAtMs !== null) return nextAtMs;
  const restockedAtMs = timestampMs(entry?.restockedAtMs);
  return restockedAtMs === null ? null : restockedAtMs + CHECK_INTERVAL_MS;
}

function stockMessageNextRestockAtMs(message) {
  const text = (Array.isArray(message?.components) ? message.components : [])
    .map(componentText)
    .join('\n');
  const match = text.match(/\bRestock\s+<t:(\d+):[A-Za-z]>/i);
  return match ? Number(match[1]) * 1000 : null;
}

function messageCreatedAtMs(message) {
  const createdAtMs = Number(message?.createdTimestamp);
  if (Number.isFinite(createdAtMs)) return createdAtMs;
  try {
    return Number(BigInt(String(message?.id || '0')) >> 22n) + 1420070400000;
  } catch {
    return 0;
  }
}

async function findRecentStockCycleMessages(channel, clientUserId, entry, nowMs = Date.now()) {
  if (typeof channel?.messages?.fetch !== 'function') return [];
  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  if (!messages || typeof messages.values !== 'function') return [];
  const expectedHeader = `## GAG2 ${entry?.label || ''}`;
  const result = [];
  for (const message of messages.values()) {
    const ownMessage = clientUserId
      ? message?.author?.id === clientUserId
      : message?.author?.bot === true;
    if (!ownMessage) continue;
    const createdAtMs = messageCreatedAtMs(message);
    if (createdAtMs && createdAtMs < nowMs - RECENT_STOCK_DEDUPE_WINDOW_MS) continue;
    const text = (Array.isArray(message?.components) ? message.components : [])
      .map(componentText)
      .join('\n');
    if (!text.includes(expectedHeader)) continue;
    const nextRestockAtMs = stockMessageNextRestockAtMs(message);
    if (!Number.isFinite(nextRestockAtMs)) continue;
    result.push({ message, nextRestockAtMs, createdAtMs });
  }
  return result.sort((left, right) => right.nextRestockAtMs - left.nextRestockAtMs
    || right.createdAtMs - left.createdAtMs
    || String(right.message?.id || '').localeCompare(String(left.message?.id || '')));
}

async function removeDuplicateStockCycleMessages(matches, keeper) {
  const duplicates = matches.filter((match) => match.message?.id !== keeper?.message?.id
    && typeof match.message?.delete === 'function');
  const results = await Promise.allSettled(duplicates.map((match) => match.message.delete()));
  return results.filter((result) => result.status === 'fulfilled').length;
}

function updateStockPostMetadata(bucket, entry, nextRestockAtMs = stockNextRestockAtMs(entry)) {
  if (Number.isFinite(nextRestockAtMs)) bucket.lastStockNextRestockAtMs = nextRestockAtMs;
  const restockedAtMs = timestampMs(entry?.restockedAtMs);
  if (restockedAtMs !== null) bucket.lastStockRestockedAtMs = restockedAtMs;
}

function componentText(component) {
  const raw = typeof component?.toJSON === 'function' ? component.toJSON() : component;
  if (!raw || typeof raw !== 'object') return '';
  return [
    raw.content,
    raw.description,
    raw.label,
    ...(Array.isArray(raw.components) ? raw.components.map(componentText) : []),
  ].filter(Boolean).join('\n');
}

function isRecentUnavailableMessage(message, clientUserId, nowMs = Date.now()) {
  const ownMessage = clientUserId
    ? message?.author?.id === clientUserId
    : message?.author?.bot === true;
  if (!ownMessage) return false;
  const createdAt = Number(message?.createdTimestamp);
  if (Number.isFinite(createdAt) && createdAt < nowMs - RECENT_UNAVAILABLE_CLEANUP_WINDOW_MS) return false;
  const text = [
    message?.content,
    ...(Array.isArray(message?.components) ? message.components.map(componentText) : []),
  ].filter(Boolean).join('\n');
  return /source(?:\s+temporarily)?\s+unavailable|gag\.gg\/api\/[^\s]+.*HTTP 403/i.test(text);
}

function sourceGroupForType(type) {
  if (type === 'fallStock') return 'Fall Harvest stock';
  if (type === 'fallSell') return 'Fall Harvest sell';
  if (STOCK_TYPE_GROUPS.stock.includes(type)) return 'stock';
  if (STOCK_TYPE_GROUPS.weather.includes(type)) return 'weather';
  if (type === 'sell') return 'sell';
  return String(type || 'unknown');
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
  const fallMultipliers = selectedFilterValues(filters, ['fall', 'sellMultipliers'], GAG2_SELL_MULTIPLIERS);
  const includeUnknownRarity = rarities.size === GAG2_SELL_FILTER_RARITIES.length;
  const filterEntries = (items, catalogType) => (items || []).filter((item) => {
    const rarity = normalizeRarity(rarityForType(catalogType, item));
    return multipliers.has(sellFilterBucket(item)) && (rarities.has(rarity) || (!rarity && includeUnknownRarity));
  });
  const entries = filterEntries(entry?.entries, 'sell');
  const fall = entry?.fall ? {
    ...entry.fall,
    entries: (entry.fall.entries || []).filter((item) => fallMultipliers.has(sellFilterBucket(item))),
    enabledMultipliers: [...fallMultipliers],
  } : entry?.fall;
  return {
    ...entry,
    entries,
    fall,
    enabledMultipliers: [...multipliers],
  };
}

function filteredRoleSpecs(type, specs, filters = {}) {
  if (['seed', 'gear', 'crate'].includes(type)) {
    if (Array.isArray(filters?.roleItems?.[type])) {
      const selectedItems = new Set(filters.roleItems[type]);
      return specs.filter((spec) => selectedItems.has(spec.key));
    }
    const selected = selectedFilterValues(filters, ['rarities', type], GAG2_ROLE_FILTER_RARITIES);
    return specs.filter((spec) => !GAG2_ROLE_FILTER_RARITIES.includes(spec.rarity) || selected.has(spec.rarity));
  }
  if (type === 'sell') {
    const rarities = selectedFilterValues(filters, ['rarities', 'sell'], GAG2_SELL_FILTER_RARITIES);
    const multipliers = selectedFilterValues(filters, ['sellMultipliers'], GAG2_SELL_MULTIPLIERS);
    return specs.filter((spec) => rarities.has(spec.rarity) && multipliers.has(spec.bucket));
  }
  const fallStockType = Object.entries(FALL_ROLE_TYPES).find(([, roleType]) => roleType === type)?.[0];
  if (fallStockType) {
    const selected = selectedFilterValues(filters, ['fall', 'roleItems', fallStockType], []);
    return specs.filter((spec) => selected.has(spec.key));
  }
  return specs;
}

async function roleSpecsForTypes(types, filters = {}) {
  const specsByType = Object.fromEntries(ROLE_TYPES.map((type) => [type, []]));
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
  const disabled = ROLE_TYPES.filter((type) => !enabledTypes.includes(type));
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
  const requests = [];
  const needStock = targets.some((target) => STOCK_TYPE_GROUPS.stock.includes(target.type));
  const needWeather = targets.some((target) => STOCK_TYPE_GROUPS.weather.includes(target.type));
  const needSell = targets.some((target) => target.type === 'sell');
  const needFallStock = targets.some((target) => target.fallEnabled && STOCK_TYPE_GROUPS.stock.includes(target.type));
  const needFallSell = targets.some((target) => target.fallEnabled && target.type === 'sell');

  if (needStock) {
    requests.push((async () => {
      try {
        const stockPayload = await fetchers.fetchStockPayload();
        for (const entry of stockPayload.stock) entries.set(entry.category, entry);
      } catch (error) {
        for (const type of STOCK_TYPE_GROUPS.stock) errors.set(type, error);
      }
    })());
  }

  if (needFallStock) {
    requests.push((async () => {
      try {
        const stockPayload = await fetchers.fetchFallStockPayload();
        for (const entry of stockPayload.stock) entries.set(`fall:${entry.category}`, entry);
      } catch (error) {
        errors.set('fallStock', error);
      }
    })());
  }

  if (needWeather) {
    requests.push((async () => {
      try {
        const weatherPayload = await fetchers.fetchWeatherPayload();
        entries.set('weather', weatherPayload);
        entries.set('moon', weatherPayload);
      } catch (error) {
        errors.set('weather', error);
        errors.set('moon', error);
      }
    })());
  }

  if (needSell) {
    requests.push((async () => {
      try {
        entries.set('sell', await fetchers.fetchSellPayload());
      } catch (error) {
        errors.set('sell', error);
      }
    })());
  }

  if (needFallSell) {
    requests.push((async () => {
      try {
        entries.set('fall:sell', await fetchers.fetchFallSellPayload());
      } catch (error) {
        errors.set('fallSell', error);
      }
    })());
  }

  await Promise.all(requests);
  return { entries, errors };
}

class Gag2StockPoster {
  constructor(client, options = {}) {
    this.client = client;
    this.checkIntervalMs = options.checkIntervalMs || CHECK_INTERVAL_MS;
    this.checkScheduleSecondMs = options.checkScheduleSecondMs ?? CHECK_SCHEDULE_SECOND_MS;
    this.checkScheduleOffsetMs = options.checkScheduleOffsetMs ?? CHECK_SCHEDULE_UTC_OFFSET_MS;
    const weatherInterval = Number(options.weatherCheckIntervalMs);
    const weatherInitialDelay = Number(options.weatherInitialDelayMs);
    const sellInterval = Number(options.sellCheckIntervalMs);
    const sellScheduleSecond = Number(options.sellCheckScheduleSecondMs);
    this.weatherCheckIntervalMs = Math.max(5_000, Number.isFinite(weatherInterval) ? weatherInterval : WEATHER_CHECK_INTERVAL_MS);
    this.weatherInitialDelayMs = Math.max(0, Number.isFinite(weatherInitialDelay) ? weatherInitialDelay : 1_000);
    this.sellCheckIntervalMs = Math.max(60_000, Number.isFinite(sellInterval) ? sellInterval : SELL_CHECK_INTERVAL_MS);
    this.sellCheckScheduleSecondMs = Math.max(0, Math.min(this.sellCheckIntervalMs - 1, Number.isFinite(sellScheduleSecond) ? sellScheduleSecond : SELL_CHECK_SCHEDULE_SECOND_MS));
    this.sellUnchangedRetryMs = Math.max(1_000, Number(options.sellUnchangedRetryMs) || SELL_UNCHANGED_RETRY_MS);
    this.sellFailureRetryLimit = Math.max(1, Number(options.sellFailureRetryLimit) || SELL_FAILURE_RETRY_LIMIT);
    this.stockFailureRetryMs = Math.max(250, Number(options.stockFailureRetryMs) || STOCK_FAILURE_RETRY_MS);
    this.stockFailureRetryLimit = Math.max(1, Number(options.stockFailureRetryLimit) || STOCK_FAILURE_RETRY_LIMIT);
    this.fetchers = {
      fetchFallSellPayload: options.fetchFallSellPayload || fetchFallSellPayload,
      fetchFallStockPayload: options.fetchFallStockPayload || fetchFallStockPayload,
      fetchSellPayload: options.fetchSellPayload || fetchSellPayload,
      fetchStockPayload: options.fetchStockPayload || fetchStockPayload,
      fetchWeatherPayload: options.fetchWeatherPayload || fetchWeatherPayload,
    };
    this.now = options.now || (() => Date.now());
    this.statePath = options.statePath || STATE_PATH;
    this.logSystem = options.logSystem || logCommandSystem;
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
    this.nextDelayOverrideMs = null;
    this.nextSellDelayOverrideMs = null;
    this.stockFailureRetryCount = 0;
    this.sellFailureRetryCount = 0;
  }

  async start() {
    if (this.started) return this;
    this.started = true;
    await this.deleteRecentUnavailableMessages().catch((error) => {
      this.logSystem(`GAG2 recent error cleanup failed: ${error?.message || 'unknown error'}`);
    });
    this.scheduleNextTick();
    this.scheduleWeatherTick(this.weatherInitialDelayMs);
    this.scheduleSellTick();
    setTimeout(() => {
      syncAllGag2StockSetups(this.client, this.fetchers)
        .then(() => syncAllGag2RoleAssignmentPanels(this.client))
        .catch((error) => {
          logCommandSystem(`GAG2 startup sync failed: ${error?.message || 'unknown error'}`);
        });
    }, 5_000).unref?.();
    return this;
  }

  cleanupTargets() {
    const targets = [];
    for (const guildId of getConfiguredGuildIds({ includeDisabled: true })) {
      const channels = getGuildConfigRaw(guildId)?.gag2Stock?.channels || {};
      for (const type of STOCK_TYPES) {
        const channelId = cleanChannelId(channels[type]);
        if (channelId) targets.push({ guildId, type, channelId });
      }
    }
    return targets;
  }

  async deleteRecentUnavailableMessages() {
    const grouped = new Map();
    for (const target of this.cleanupTargets()) {
      const entry = grouped.get(target.channelId) || { channelId: target.channelId, targets: [] };
      entry.targets.push(target);
      grouped.set(target.channelId, entry);
    }
    const state = loadState(this.statePath);
    let stateChanged = false;
    const counts = await mapWithConcurrency([...grouped.values()], this.broadcastConcurrency, async (entry) => {
      const channel = this.client?.channels?.cache?.get?.(entry.channelId)
        || await this.client?.channels?.fetch?.(entry.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) return 0;
      if (typeof channel?.messages?.fetch !== 'function') return 0;
      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!messages || typeof messages.values !== 'function') return 0;
      let removed = 0;
      for (const message of messages.values()) {
        if (!isRecentUnavailableMessage(message, this.client?.user?.id, this.now())) continue;
        if (typeof message?.delete !== 'function') continue;
        const deleted = await message.delete().then(() => true).catch(() => false);
        if (deleted) removed += 1;
      }
      if (removed) {
        for (const target of entry.targets) {
          const bucket = state.unavailable?.[target.guildId]?.[target.type];
          if (!bucket) continue;
          delete bucket.lastMessageId;
          delete bucket.lastPostedAt;
          delete bucket.lastPostedKey;
          stateChanged = true;
        }
      }
      return removed;
    });
    const removed = counts.reduce((sum, count) => sum + count, 0);
    if (stateChanged) saveState(state, this.statePath);
    if (removed) this.logSystem(`GAG2 removed ${removed} recent stock error message${removed === 1 ? '' : 's'}.`);
    return removed;
  }

  scheduleNextTick(delayOverrideMs = null) {
    if (!this.started) return null;
    const now = this.now();
    const override = Number.isFinite(this.nextDelayOverrideMs) ? Math.max(0, this.nextDelayOverrideMs) : delayOverrideMs;
    this.nextDelayOverrideMs = null;
    const hasOverride = override !== null && override !== undefined && Number.isFinite(Number(override));
    const retryAllowed = hasOverride && this.stockFailureRetryCount < this.stockFailureRetryLimit;
    if (retryAllowed) this.stockFailureRetryCount += 1;
    else this.stockFailureRetryCount = 0;
    const nextAt = retryAllowed
      ? now + Math.max(0, Number(override))
      : nextGag2StockTickAtMs(now, {
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
    const retryAllowed = hasOverride && this.sellFailureRetryCount < this.sellFailureRetryLimit;
    if (retryAllowed) this.sellFailureRetryCount += 1;
    else this.sellFailureRetryCount = 0;
    const nextAt = retryAllowed
      ? now + Math.max(0, Number(override))
      : nextGag2StockTickAtMs(now, {
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

  async reconcileSellMessages(channel, entry, payloads, sentMessages) {
    const clientUserId = this.client?.user?.id;
    const expectedRefreshAtMs = timestampMs(entry?.nextRefreshAtMs);
    if (expectedRefreshAtMs === null) return;
    const partFingerprints = payloads.map((part) => componentFingerprint(part?.components));
    for (let attempt = 1; attempt <= SELL_RECONCILIATION_MAX_RETRIES; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, SELL_RECONCILIATION_BACKOFF_MS * attempt));
      let allClean = true;
      for (let i = 0; i < partFingerprints.length; i++) {
        const matches = await findMatchingRecentSellMessages(
          channel, clientUserId, expectedRefreshAtMs, partFingerprints[i], this.now(),
        );
        if (matches.length <= 1) continue;
        allClean = false;
        const keeper = matches[0];
        const duplicates = matches.slice(1).filter((match) => typeof match.message?.delete === 'function');
        const results = await Promise.allSettled(duplicates.map((match) => match.message.delete()));
        const deleted = results.filter((r) => r.status === 'fulfilled').length;
        if (deleted) {
          this.logSystem(
            `GAG2 sell reconciliation attempt ${attempt}: cycle=${expectedRefreshAtMs} `
            + `part=${i} candidates=${matches.length} keeper=${keeper.message?.id} `
            + `deleted=${duplicates.map((d) => d.message?.id).join(',')}`,
          );
        }
      }
      if (allClean) break;
    }
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

    for (const [group, status] of groups) {
      if (!status.error) {
        this.sourceHealth.delete(group);
        continue;
      }
      const consecutiveFailures = (Number(this.sourceHealth.get(group)?.consecutiveFailures) || 0) + 1;
      // Source failures are intentionally kept internal. Never expose an API
      // URL, status, or response detail in Discord or the owner live console.
      this.sourceHealth.set(group, { consecutiveFailures });
    }
  }

  postPermissionFailureKey(target) {
    return `${target.guildId}:${target.type}:${target.channelId}`;
  }

  postPermissionStopped(target, postKey) {
    const record = this.postPermissionFailures.get(this.postPermissionFailureKey(target));
    return record?.postKey === postKey;
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
    const channelName = String(channel?.name || '').trim();
    const location = channelName ? `#${channelName} (${target.channelId})` : `channel ${target.channelId}`;
    const guildName = String(channel?.guild?.name || '').trim();
    const guildLocation = guildName ? `${guildName} (${target.guildId})` : target.guildId;
    const details = [];
    if (diagnostic?.server?.length) details.push(`Missing server role permissions: ${diagnostic.server.join(', ')}`);
    if (diagnostic?.channel?.length) details.push(`Missing channel/category permissions in ${location}: ${diagnostic.channel.join(', ')}`);
    if (diagnostic?.unknown?.length) details.push(diagnostic.unknown.join(', '));
    if (!details.length) details.push('Discord returned Missing Permissions (50013)');
    const diagnosticKey = details.join('|');
    this.postPermissionFailures.set(key, { postKey, diagnosticKey, reported: true });
    if (previous?.diagnosticKey !== diagnosticKey) {
      this.logSystem(
        `GAG2 ${target.type} posting paused for guild ${guildLocation}. `
        + `${details.join('. ')}. Only this destination is skipped until its permissions are restored.`,
      );
    }
    return null;
  }

  clearPostPermissionFailure(target, postKey, channel = null) {
    const key = this.postPermissionFailureKey(target);
    const record = this.postPermissionFailures.get(key);
    if (!record) return;
    this.postPermissionFailures.delete(key);
    if (record.postKey !== postKey || !record.reported) return;
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
      const fallEnabledTypes = activeFallTypes(config, this.now());
      for (const type of STOCK_TYPES) {
        if (!allowedTypes.has(type)) continue;
        const channelId = cleanChannelId(channels[type]);
        if (!channelId) continue;
        targets.push({
          guildId,
          type,
          channelId,
          roleIds: config?.gag2Stock?.roleIds?.[type] || {},
          fallEnabled: GAG2_FALL_STOCK_TYPES.includes(type) && fallEnabledTypes.has(type),
          fallRoleIds: config?.gag2Stock?.roleIds?.[fallRoleTypeForStock(type)] || {},
          filters: {
            ...(config?.gag2Stock?.filters || {}),
            fall: config?.gag2Stock?.fall || {},
          },
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
    try {
      const tickStartedAtMs = this.now();
      const targets = this.targets(tickTypes);
      if (!targets.length) return null;
      const state = loadState(this.statePath);
      const { entries, errors } = await fetchEntriesForTargets(targets, this.fetchers);
      const healthTargets = [...targets];
      if (targets.some((target) => target.fallEnabled && STOCK_TYPE_GROUPS.stock.includes(target.type))) {
        healthTargets.push({ type: 'fallStock' });
      }
      if (targets.some((target) => target.fallEnabled && target.type === 'sell')) {
        healthTargets.push({ type: 'fallSell' });
      }
      this.updateSourceHealth(healthTargets, errors);
      if (targets.some((target) => STOCK_TYPE_GROUPS.stock.includes(target.type)
        && (errors.has(target.type) || (target.fallEnabled && errors.has('fallStock'))))) {
        this.nextDelayOverrideMs = this.stockFailureRetryMs;
      }
      if (targets.some((target) => target.type === 'sell'
        && (errors.has('sell') || (target.fallEnabled && errors.has('fallSell'))))) {
        this.nextSellDelayOverrideMs = this.sellUnchangedRetryMs;
      }
      const deliveries = await mapWithConcurrency(targets, this.broadcastConcurrency, async (target) => {
        const error = errors.get(target.type);
        if (error) {
          return this.postUnavailableOnce(state, target).catch(() => null);
        }

        let entry = entries.get(target.type);
        if (!entry) return null;
        if (target.fallEnabled && isFallHarvestActive(this.now())) {
          const fallError = errors.get(target.type === 'sell' ? 'fallSell' : 'fallStock');
          if (!fallError) {
            const fallEntry = entries.get(`fall:${target.type}`);
            if (fallEntry) entry = { ...entry, fall: fallEntry };
          }
        }
        if (target.type === 'sell') {
          entry = filterSellEntry(entry, target.filters);
          if (!entry.entries.length && !entry.fall?.entries?.length) return null;
          if (isApiRefreshDue(target.type, entry, tickStartedAtMs)) {
            this.nextSellDelayOverrideMs = this.sellUnchangedRetryMs;
            return null;
          }
        }
        if (STOCK_TYPE_GROUPS.stock.includes(target.type)) {
          const staleMain = isApiRefreshDue(target.type, entry, tickStartedAtMs);
          const staleFall = entry.fall && isApiRefreshDue(target.type, entry.fall, tickStartedAtMs);
          if (staleMain || staleFall) {
            this.nextDelayOverrideMs = this.stockFailureRetryMs;
            return null;
          }
        }
        if (resetUnavailableFailures(state, target, tickStartedAtMs)) saveState(state, this.statePath);
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
    // Different retry groups can overlap and arrive here with separate state
    // snapshots. Reload after the per-destination send lock is acquired so the
    // duplicate check always sees the last successful post.
    if (STOCK_TYPE_GROUPS.stock.includes(target.type)) state = loadState(this.statePath);
    const bucket = postBucket(state, target.guildId, target.type);
    const postKey = buildTypePostKey(target.type, entry);
    if (STOCK_TYPE_GROUPS.stock.includes(target.type)) {
      const incomingNextRestockAtMs = stockNextRestockAtMs(entry);
      const lastNextRestockAtMs = timestampMs(bucket.lastStockNextRestockAtMs);
      if (incomingNextRestockAtMs !== null
        && lastNextRestockAtMs !== null
        && incomingNextRestockAtMs <= lastNextRestockAtMs) {
        return null;
      }
    }
    if (target.type === 'weather' && isInactiveWeatherEntry(entry, this.now())) {
      if (bucket.lastPostedKey) {
        this.clearPostPermissionFailure(target, bucket.lastPostedKey);
        bucket.lastPostedKey = null;
        bucket.lastWeatherInactiveAt = new Date(this.now()).toISOString();
        saveState(state, this.statePath);
      }
      return null;
    }
    if (target.type === 'sell') {
      if (sellEntryIsOlderThanBucket(bucket, entry)) {
        return null;
      }
      if (sellEntryIsSameOrOlderCycle(bucket, entry) && recentSellPostKeys(bucket).includes(postKey)) {
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

    const payloads = buildTypePayloads(target.type, entry, {
      roleIds: target.roleIds,
      fallRoleIds: target.fallRoleIds,
    });
    const payload = payloads[0];
    if (STOCK_TYPE_GROUPS.stock.includes(target.type)) {
      const incomingNextRestockAtMs = stockNextRestockAtMs(entry);
      const recentCycles = await findRecentStockCycleMessages(channel, this.client?.user?.id, entry, this.now());
      const latestCycle = recentCycles[0];
      if (incomingNextRestockAtMs !== null
        && latestCycle
        && latestCycle.nextRestockAtMs >= incomingNextRestockAtMs) {
        const sameCycle = recentCycles.filter((match) => match.nextRestockAtMs === latestCycle.nextRestockAtMs);
        await removeDuplicateStockCycleMessages(sameCycle, latestCycle);
        Object.assign(bucket, {
          channelId: target.channelId,
          lastMessageId: latestCycle.message?.id || null,
          lastPostedAt: new Date(latestCycle.createdAtMs || this.now()).toISOString(),
          lastPostedKey: latestCycle.nextRestockAtMs === incomingNextRestockAtMs
            ? postKey
            : (bucket.lastPostedKey || null),
        });
        updateStockPostMetadata(bucket, entry, latestCycle.nextRestockAtMs);
        saveState(state, this.statePath);
        this.clearPostPermissionFailure(target, postKey, channel);
        return null;
      }
    }
    if (target.type === 'sell' && (!bucket.lastPostedKey || sellEntryIsSameOrOlderCycle(bucket, entry))) {
      const expectedRefreshAtMs = timestampMs(entry?.nextRefreshAtMs);
      let allPartsExist = true;
      let firstMatchedMessageId = null;
      for (const part of payloads) {
        const fp = componentFingerprint(part?.components);
        const matches = await findMatchingRecentSellMessages(channel, this.client?.user?.id, expectedRefreshAtMs, fp, this.now());
        if (!matches.length) { allPartsExist = false; break; }
        if (!firstMatchedMessageId && matches[0]?.message?.id) {
          firstMatchedMessageId = matches[0].message.id;
        }
      }
      if (allPartsExist) {
        if (!bucket.lastPostedKey) {
          Object.assign(bucket, {
            channelId: target.channelId,
            lastMessageId: firstMatchedMessageId || null,
            lastPostedAt: new Date(this.now()).toISOString(),
            lastPostedKey: postKey,
          });
          updateSellPostMetadata(bucket, entry);
        } else {
          rememberSellPostKey(bucket, postKey);
        }
        saveState(state, this.statePath);
        this.clearPostPermissionFailure(target, postKey, channel);
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
    const sentMessages = [];
    if (!message) {
      try {
        for (const part of payloads) sentMessages.push(await channel.send(part));
        [message] = sentMessages;
      } catch (error) {
        if (sentMessages.length) {
          await Promise.allSettled(sentMessages.map((sent) => sent?.delete?.()));
        }
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
    if (STOCK_TYPE_GROUPS.stock.includes(target.type)) {
      const incomingNextRestockAtMs = stockNextRestockAtMs(entry);
      if (incomingNextRestockAtMs !== null) {
        const sameCycle = (await findRecentStockCycleMessages(channel, this.client?.user?.id, entry, this.now()))
          .filter((match) => match.nextRestockAtMs === incomingNextRestockAtMs);
        if (sameCycle.length) {
          const keeper = sameCycle[0];
          const removed = await removeDuplicateStockCycleMessages(sameCycle, keeper);
          message = keeper.message || message;
          if (removed) logCommandSystem(`GAG2 removed ${removed} duplicate ${target.type} announcement${removed === 1 ? '' : 's'} in ${target.channelId}.`);
        }
      }
    }
    if (target.type === 'sell' && sentMessages.length > 1) {
      await this.reconcileSellMessages(channel, entry, payloads, sentMessages).catch((error) => {
        this.logSystem(`GAG2 sell reconciliation failed: ${error?.message || 'unknown error'}`);
      });
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
      lastMessageIds: sentMessages.length > 1 ? sentMessages.map((sent) => sent?.id).filter(Boolean) : undefined,
      lastPostedAt: new Date(this.now()).toISOString(),
      lastPostedKey: postKey,
    });
    if (STOCK_TYPE_GROUPS.stock.includes(target.type)) updateStockPostMetadata(bucket, entry);
    if (target.type === 'sell') updateSellPostMetadata(bucket, entry);
    saveState(state, this.statePath);
    this.clearPostPermissionFailure(target, postKey, channel);
    logCommandSystem(`GAG2 ${target.type} posted to ${target.channelId}${payloads.length > 1 ? ` in ${payloads.length} messages` : ''}: ${postKey}`);
    return message;
  }

  async postUnavailableOnce(state, target) {
    const bucket = unavailableBucket(state, target.guildId, target.type);
    bucket.consecutiveFailures = (Number(bucket.consecutiveFailures) || 0) + 1;
    bucket.lastErrorAt = new Date(this.now()).toISOString();
    delete bucket.lastErrorMessage;
    delete bucket.lastMessageId;
    delete bucket.lastPostedAt;
    delete bucket.lastPostedKey;
    saveState(state, this.statePath);
    return null;
  }
}

async function syncGag2StockGuildSetup(client, guildId, fetchers = {}, options = {}) {
  if (fetchers && typeof fetchers === 'object' && (fetchers.progressGuildId || fetchers.onProgress)) {
    options = fetchers;
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
  const setupNowMs = typeof options.now === 'function' ? options.now() : Date.now();
  const fallEnabledTypes = activeFallTypes(config, setupNowMs);
  const enabledRoleTypes = [
    ...enabledTypes,
    ...GAG2_FALL_STOCK_TYPES
      .filter((type) => enabledTypes.includes(type) && fallEnabledTypes.has(type))
      .map((type) => FALL_ROLE_TYPES[type])
      .filter((type) => type && type !== FALL_ROLE_TYPES.sell),
  ];

  const me = guild.members?.me || await guild.members?.fetchMe?.().catch(() => null);
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
    logCommandSystem(`GAG2 role sync skipped for guild ${guild.id}: bot lacks Manage Roles.`);
    progressGuildId && progress({ action: 'checking', remaining: 0, total: 0, status: 'error', message: 'Bot lacks Manage Roles' });
    return null;
  }

  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const specsByType = await roleSpecsForTypes(enabledRoleTypes, {
    ...(config?.gag2Stock?.filters || {}),
    fall: config?.gag2Stock?.fall || {},
  });
  const disabledRemoval = await clearDisabledTypeRoles(guild, config, enabledRoleTypes, roles, progress);
  if (!enabledRoleTypes.length) {
    if (!disabledRemoval.failed) progressGuildId && progress({ action: disabledRemoval.removed ? 'removing' : 'checking', remaining: 0, total: disabledRemoval.removed, status: 'done', message: disabledRemoval.removed ? 'Removed roles' : 'No roles needed' });
    return { removed: disabledRemoval.removed, failed: disabledRemoval.failed, added: 0 };
  }

  const filteredRemoval = await clearFilteredTypeRoles(guild, config, enabledRoleTypes, specsByType, roles, progress);
  const removal = {
    removed: disabledRemoval.removed + filteredRemoval.removed,
    failed: disabledRemoval.failed + filteredRemoval.failed,
  };
  const syncedConfig = getGuildConfig(guild.id);
  const byName = new Map([...roles.values()].map((role) => [role.name.toLowerCase(), role]));
  const result = {};
  let addRemaining = 0;
  for (const type of enabledRoleTypes) {
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

  for (const type of enabledRoleTypes) {
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
  activeFallTypes,
  Gag2StockPoster,
  comparableComponent,
  componentFingerprint,
  diagnosePostPermissions,
  filterSellEntry,
  findMatchingRecentBotMessage,
  findMatchingRecentSellMessages,
  filteredRoleSpecs,
  getGag2StockSetupProgress,
  isInactiveWeatherEntry,
  isRecentUnavailableMessage,
  currentGag2StockCycleAtMs,
  nextGag2StockTickAtMs,
  roleSpecsForTypes,
  sellMessageNextRefreshAtMs,
  startGag2StockPoster,
  syncAllGag2StockSetups,
  syncGag2StockGuildSetup,
};
