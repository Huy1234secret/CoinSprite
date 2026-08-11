const path = require('path');
const { backupFileOnce, readJsonFile, writeJsonAtomic } = require('./jsonFileStore');
const { FALL_ROLE_TYPES, roleSpecsForType } = require('./gag2Stock/catalog');

const STORE_PATH = path.join(__dirname, '..', 'data', 'server-config.json');
const SCHEMA_VERSION = 12;
const FEATURE_LOCK_RESET_SCHEMA_VERSION = 10;
const DEFAULT_GUILD_ID = process.env.DEFAULT_GUILD_ID || '1493901002519347290';
const DEFAULT_GAG2_STOCK_CHANNEL_ID = '1525184164930916433';
const GAG2_BASE_STOCK_ROLE_KEYS = ['seed', 'gear', 'crate', 'weather', 'moon', 'sell'];
const GAG2_FALL_STOCK_TYPES = ['seed', 'gear', 'crate', 'sell'];
const GAG2_FALL_ROLE_KEYS = GAG2_FALL_STOCK_TYPES.map((type) => FALL_ROLE_TYPES[type]);
const GAG2_STOCK_ROLE_KEYS = [...GAG2_BASE_STOCK_ROLE_KEYS, ...GAG2_FALL_ROLE_KEYS];
const GAG2_STOCK_CHANNEL_KEYS = [...GAG2_BASE_STOCK_ROLE_KEYS, 'roleAssign', 'updates'];
const GAG2_ROLE_FILTER_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'super'];
const GAG2_SELL_FILTER_RARITIES = [...GAG2_ROLE_FILTER_RARITIES, 'secret'];
const GAG2_SELL_MULTIPLIERS = ['normal', '2x', '4x'];
const GAG2_FALL_SELL_MULTIPLIERS = ['normal', '2x', '4x'];
const DEFAULT_LEVELING_CONFIG = Object.freeze({
  enabled: false,
  xp: Object.freeze({ min: 15, max: 25, cooldownSeconds: 60 }),
  curve: Object.freeze({ baseXp: 100, growth: 1.5, maxLevel: 100 }),
  announcements: Object.freeze({
    enabled: false,
    channelId: '',
    template: '## ✦ Level {level} reached\nGG {user}! You reached level {level}.\n\n`{bar}` {progress_xp} / {needed_xp} XP toward level {next_level}',
    layout: Object.freeze({
      container: true,
      accentColor: '#b9f547',
      thumbnailEnabled: false,
      thumbnailUrl: '',
      galleryUrls: Object.freeze([]),
    }),
  }),
  channelMultipliers: Object.freeze({}),
  roleRewards: Object.freeze([]),
  roleBoosts: Object.freeze([]),
  stackRoleRewards: true,
});
const DEFAULT_RNG_GAME_CONFIG = Object.freeze({
  enabled: false,
  gameChannelIds: Object.freeze([]),
  cooldownBypassRoleIds: Object.freeze([]),
});
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function blankChannels() {
  return Object.fromEntries(GAG2_STOCK_CHANNEL_KEYS.map((key) => [key, '']));
}

function blankRoleIds() {
  return Object.fromEntries(GAG2_STOCK_ROLE_KEYS.map((key) => [key, {}]));
}

function defaultFilters() {
  return {
    rarities: {
      seed: [...GAG2_ROLE_FILTER_RARITIES],
      gear: [...GAG2_ROLE_FILTER_RARITIES],
      crate: [...GAG2_ROLE_FILTER_RARITIES],
      sell: [...GAG2_SELL_FILTER_RARITIES],
    },
    roleItems: Object.fromEntries(['seed', 'gear', 'crate'].map((type) => [
      type,
      roleSpecsForType(type).map((spec) => spec.key),
    ])),
    sellMultipliers: [...GAG2_SELL_MULTIPLIERS],
  };
}

function defaultFall() {
  return {
    enabledTypes: [],
    roleItems: Object.fromEntries(['seed', 'gear', 'crate'].map((type) => [type, []])),
    sellMultipliers: [...GAG2_FALL_SELL_MULTIPLIERS],
  };
}

const DEFAULT_FEATURES = Object.freeze({
  gag2Stock: true,
  leveling: false,
  rngGame: false,
  fullBot: false,
});
const DEFAULT_GAG2_STOCK_CONFIG = Object.freeze({
  enabled: true,
  channels: blankChannels(),
  roleIds: blankRoleIds(),
  filters: defaultFilters(),
  fall: defaultFall(),
  rolesSyncedAt: '',
});
const DEFAULT_GUILD_CONFIG = Object.freeze({
  enabled: true,
  features: DEFAULT_FEATURES,
  channels: { commandLogThread: '' },
  gag2Stock: DEFAULT_GAG2_STOCK_CONFIG,
  leveling: DEFAULT_LEVELING_CONFIG,
  rngGame: DEFAULT_RNG_GAME_CONFIG,
});
const DEFAULT_COINSPRITE_GUILD_CONFIG = Object.freeze({
  ...DEFAULT_GUILD_CONFIG,
  gag2Stock: {
    ...DEFAULT_GAG2_STOCK_CONFIG,
    channels: {
      ...blankChannels(),
      seed: DEFAULT_GAG2_STOCK_CHANNEL_ID,
      gear: DEFAULT_GAG2_STOCK_CHANNEL_ID,
      crate: DEFAULT_GAG2_STOCK_CHANNEL_ID,
    },
  },
});
const DEFAULT_STATE = Object.freeze({
  meta: { schemaVersion: SCHEMA_VERSION, disabledGuilds: {} },
  guilds: { [DEFAULT_GUILD_ID]: DEFAULT_COINSPRITE_GUILD_CONFIG },
});

function cleanId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function normalizeSelection(value, allowed, fallback = allowed) {
  if (!Array.isArray(value)) return [...fallback];
  const selected = new Set(value.map((item) => String(item || '').trim().toLowerCase()));
  return allowed.filter((item) => selected.has(item));
}

function normalizeRoleIdMap(value) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, id]) => [String(key || '').trim(), cleanId(id)])
    .filter(([key, id]) => key && id));
}

function normalizeFilters(value, defaults = defaultFilters()) {
  const source = isObject(value) ? value : {};
  const rarities = {
    seed: normalizeSelection(source.rarities?.seed, GAG2_ROLE_FILTER_RARITIES, defaults.rarities.seed),
    gear: normalizeSelection(source.rarities?.gear, GAG2_ROLE_FILTER_RARITIES, defaults.rarities.gear),
    crate: normalizeSelection(source.rarities?.crate, GAG2_ROLE_FILTER_RARITIES, defaults.rarities.crate),
    sell: normalizeSelection(source.rarities?.sell, GAG2_SELL_FILTER_RARITIES, defaults.rarities.sell),
  };
  const roleItems = {};
  for (const type of ['seed', 'gear', 'crate']) {
    const specs = roleSpecsForType(type);
    const allowed = specs.map((spec) => spec.key);
    const rarityFallback = specs.filter((spec) => rarities[type].includes(spec.rarity)).map((spec) => spec.key);
    roleItems[type] = normalizeSelection(source.roleItems?.[type], allowed, defaults.roleItems?.[type] || rarityFallback);
    if (!Array.isArray(source.roleItems?.[type])) roleItems[type] = rarityFallback;
  }
  return {
    rarities,
    roleItems,
    sellMultipliers: normalizeSelection(source.sellMultipliers, GAG2_SELL_MULTIPLIERS, defaults.sellMultipliers),
  };
}

function normalizeFall(value, defaults = defaultFall()) {
  const source = isObject(value) ? value : {};
  const enabledTypes = normalizeSelection(source.enabledTypes, GAG2_FALL_STOCK_TYPES, defaults.enabledTypes);
  const roleItems = {};
  for (const type of ['seed', 'gear', 'crate']) {
    const allowed = roleSpecsForType(FALL_ROLE_TYPES[type]).map((spec) => spec.key);
    roleItems[type] = normalizeSelection(source.roleItems?.[type], allowed, defaults.roleItems?.[type] || []);
  }
  const sellMultipliers = normalizeSelection(
    source.sellMultipliers,
    GAG2_FALL_SELL_MULTIPLIERS,
    defaults.sellMultipliers || GAG2_FALL_SELL_MULTIPLIERS,
  );
  return { enabledTypes, roleItems, sellMultipliers };
}

function normalizeGag2StockConfig(value, defaults = DEFAULT_GAG2_STOCK_CONFIG) {
  const source = isObject(value) ? value : {};
  const channels = {};
  const roleIds = {};
  for (const key of GAG2_STOCK_CHANNEL_KEYS) channels[key] = cleanId(source.channels?.[key] ?? defaults.channels?.[key]);
  for (const key of GAG2_STOCK_ROLE_KEYS) roleIds[key] = normalizeRoleIdMap(source.roleIds?.[key] ?? defaults.roleIds?.[key]);
  return {
    enabled: source.enabled === undefined ? defaults.enabled !== false : source.enabled !== false,
    channels,
    roleIds,
    filters: normalizeFilters(source.filters, defaults.filters || defaultFilters()),
    fall: normalizeFall(source.fall, defaults.fall || defaultFall()),
    rolesSyncedAt: String(source.rolesSyncedAt || ''),
  };
}

function clampNumber(value, minimum, maximum, fallback, integer = true) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(maximum, Math.max(minimum, number));
  return integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

function cleanWebUrl(value) {
  const text = String(value || '').trim().slice(0, 2000);
  if (!text) return '';
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function cleanLevelingMediaUrl(value) {
  const text = String(value || '').trim();
  return text.toLowerCase() === '{user_profile}' ? '{user_profile}' : cleanWebUrl(text);
}

function cleanHexColor(value, fallback = '#b9f547') {
  const text = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
}

function normalizeMultiplierMap(value, defaults = {}) {
  const source = isObject(value) ? value : defaults;
  return Object.fromEntries(Object.entries(source).map(([id, multiplier]) => [
    cleanId(id),
    clampNumber(multiplier, 0, 10, 1),
  ]).filter(([id]) => id).slice(0, 250));
}

function normalizeLevelingConfig(value, defaults = DEFAULT_LEVELING_CONFIG) {
  const source = isObject(value) ? value : {};
  const minimumXp = clampNumber(source.xp?.min, 1, 1000, defaults.xp.min);
  const maximumXp = clampNumber(source.xp?.max, minimumXp, 2000, Math.max(minimumXp, defaults.xp.max));
  const maximumLevel = clampNumber(source.curve?.maxLevel, 1, 1000, defaults.curve.maxLevel);
  const channelMultipliers = normalizeMultiplierMap(source.channelMultipliers, defaults.channelMultipliers);
  const roleRewards = (Array.isArray(source.roleRewards) ? source.roleRewards : defaults.roleRewards)
    .map((reward) => ({
      level: clampNumber(reward?.level, 1, maximumLevel, 1),
      roleId: cleanId(reward?.roleId),
    }))
    .filter((reward) => reward.roleId)
    .sort((left, right) => left.level - right.level)
    .filter((reward, index, rewards) => index === rewards.findIndex((candidate) => candidate.level === reward.level))
    .slice(0, 100);
  const roleBoosts = (Array.isArray(source.roleBoosts) ? source.roleBoosts : (defaults.roleBoosts || []))
    .map((boost) => ({
      roleId: cleanId(boost?.roleId),
      multiplier: clampNumber(boost?.multiplier, 0, 10, 1),
    }))
    .filter((boost) => boost.roleId)
    .filter((boost, index, boosts) => index === boosts.findIndex((candidate) => candidate.roleId === boost.roleId))
    .slice(0, 100);
  const legacyTemplate = [
    `## ${String(source.announcements?.title || '✦ Level {level} reached').trim()}`,
    String(source.announcements?.message || 'GG {user}! You reached level {level}.').trim(),
    '',
    String(source.announcements?.progress || '`{bar}` {progress_xp} / {needed_xp} XP toward level {next_level}').trim(),
  ].join('\n');
  const hasLegacyTemplate = ['title', 'message', 'progress']
    .some((field) => source.announcements?.[field] !== undefined);
  const template = String(source.announcements?.template || (hasLegacyTemplate ? legacyTemplate : defaults.announcements.template))
    .trim()
    .slice(0, 3000) || defaults.announcements.template;
  const layoutSource = isObject(source.announcements?.layout) ? source.announcements.layout : {};
  const layoutDefaults = defaults.announcements.layout || DEFAULT_LEVELING_CONFIG.announcements.layout;
  return {
    enabled: source.enabled === undefined ? defaults.enabled !== false : source.enabled !== false,
    xp: {
      min: minimumXp,
      max: maximumXp,
      cooldownSeconds: clampNumber(source.xp?.cooldownSeconds, 5, 3600, defaults.xp.cooldownSeconds),
    },
    curve: {
      baseXp: clampNumber(source.curve?.baseXp, 25, 100000, defaults.curve.baseXp),
      growth: clampNumber(source.curve?.growth, 1, 3, defaults.curve.growth, false),
      maxLevel: maximumLevel,
    },
    announcements: {
      enabled: source.announcements?.enabled === undefined
        ? defaults.announcements.enabled !== false
        : source.announcements.enabled !== false,
      channelId: cleanId(source.announcements?.channelId),
      template,
      layout: {
        container: layoutSource.container === undefined ? layoutDefaults.container !== false : layoutSource.container !== false,
        accentColor: cleanHexColor(layoutSource.accentColor, layoutDefaults.accentColor),
        thumbnailEnabled: layoutSource.thumbnailEnabled === true,
        thumbnailUrl: cleanLevelingMediaUrl(layoutSource.thumbnailUrl),
        galleryUrls: [...new Set((Array.isArray(layoutSource.galleryUrls) ? layoutSource.galleryUrls : [])
          .map(cleanLevelingMediaUrl).filter(Boolean))].slice(0, 10),
      },
    },
    channelMultipliers,
    roleRewards,
    roleBoosts,
    stackRoleRewards: source.stackRoleRewards === undefined
      ? defaults.stackRoleRewards !== false
      : source.stackRoleRewards !== false,
  };
}

function normalizeRngGameConfig(value, defaults = DEFAULT_RNG_GAME_CONFIG) {
  const source = isObject(value) ? value : {};
  const channelIds = Array.isArray(source.gameChannelIds)
    ? source.gameChannelIds
    : (source.gameChannelId !== undefined
      ? [source.gameChannelId]
      : (Array.isArray(defaults.gameChannelIds) ? defaults.gameChannelIds : [defaults.gameChannelId]));
  const roleIds = Array.isArray(source.cooldownBypassRoleIds)
    ? source.cooldownBypassRoleIds.map(cleanId).filter(Boolean)
    : defaults.cooldownBypassRoleIds;
  return {
    enabled: source.enabled === undefined ? defaults.enabled === true : source.enabled === true,
    gameChannelIds: [...new Set(channelIds.map(cleanId).filter(Boolean))].slice(0, 100),
    cooldownBypassRoleIds: [...new Set(roleIds)].slice(0, 100),
  };
}

function defaultConfigForGuild(guildId) {
  return clone(guildId === DEFAULT_GUILD_ID ? DEFAULT_COINSPRITE_GUILD_CONFIG : DEFAULT_GUILD_CONFIG);
}

function normalizeGuildConfig(guildId, value, options = {}) {
  const source = isObject(value) ? value : {};
  const defaults = defaultConfigForGuild(guildId);
  const leveling = normalizeLevelingConfig(source.leveling, defaults.leveling);
  const rngGame = normalizeRngGameConfig(source.rngGame, defaults.rngGame);
  if (options.resetFeatureLocks) {
    leveling.enabled = false;
    rngGame.enabled = false;
  }
  return {
    enabled: source.enabled !== false,
    features: {
      gag2Stock: true,
      leveling: options.resetFeatureLocks ? false : source.features?.leveling === true,
      rngGame: options.resetFeatureLocks ? false : source.features?.rngGame === true,
      fullBot: false,
    },
    channels: { commandLogThread: '' },
    gag2Stock: normalizeGag2StockConfig(source.gag2Stock, defaults.gag2Stock),
    leveling,
    rngGame,
  };
}

function normalizeDisabledGuilds(value) {
  if (!isObject(value)) return {};
  const records = {};
  for (const [guildId, record] of Object.entries(value)) {
    const id = cleanId(guildId);
    if (!id) continue;
    records[id] = {
      guildId: id,
      reason: String(record?.reason || '').slice(0, 500),
      disabledBy: String(record?.disabledBy || ''),
      disabledAt: Number(record?.disabledAt) || Date.now(),
      guildName: String(record?.guildName || '').slice(0, 120),
    };
  }
  return records;
}

function normalizeState(value) {
  const source = isObject(value) ? value : {};
  const resetFeatureLocks = Number(source.meta?.schemaVersion || 0) < FEATURE_LOCK_RESET_SCHEMA_VERSION;
  const guilds = {};
  for (const [guildId, config] of Object.entries(isObject(source.guilds) ? source.guilds : {})) {
    const id = cleanId(guildId);
    if (id) guilds[id] = normalizeGuildConfig(id, config, { resetFeatureLocks });
  }
  if (!guilds[DEFAULT_GUILD_ID]) guilds[DEFAULT_GUILD_ID] = defaultConfigForGuild(DEFAULT_GUILD_ID);
  return {
    meta: { schemaVersion: SCHEMA_VERSION, disabledGuilds: normalizeDisabledGuilds(source.meta?.disabledGuilds) },
    guilds,
  };
}

function loadState() {
  const raw = readJsonFile(STORE_PATH, { label: 'GAG stock configuration', fallback: DEFAULT_STATE });
  const normalized = normalizeState(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    backupFileOnce(STORE_PATH, `${STORE_PATH}.pre-stock-only.bak`);
    writeJsonAtomic(STORE_PATH, normalized);
  }
  return normalized;
}

function saveState(state) {
  writeJsonAtomic(STORE_PATH, normalizeState(state));
}

function ensureGuildConfig(guildId) {
  const id = cleanId(guildId);
  if (!id) return null;
  const state = loadState();
  if (!state.guilds[id]) {
    state.guilds[id] = defaultConfigForGuild(id);
    saveState(state);
  }
  return getGuildConfigRaw(id);
}

function deleteGuildConfig(guildId) {
  const id = cleanId(guildId);
  if (!id || id === DEFAULT_GUILD_ID) return false;
  const state = loadState();
  if (!state.guilds[id]) return false;
  delete state.guilds[id];
  delete state.meta.disabledGuilds[id];
  saveState(state);
  return true;
}

function getGuildConfigRaw(guildId) {
  return loadState().guilds[cleanId(guildId)] || null;
}

function getGuildConfig(guildId) {
  const config = getGuildConfigRaw(guildId);
  return config?.enabled ? config : null;
}

function getGuildConfigValue(guildId, selector, fallback = null) {
  const config = getGuildConfig(guildId);
  const value = config && typeof selector === 'function' ? selector(config) : undefined;
  return value === undefined || value === null ? fallback : value;
}

function getConfiguredGuildIds({ includeDisabled = false } = {}) {
  return Object.entries(loadState().guilds).filter(([, config]) => includeDisabled || config.enabled).map(([id]) => id);
}

function getEnabledGuildIds() {
  return getConfiguredGuildIds();
}

function getDisabledGuilds() {
  return clone(loadState().meta.disabledGuilds);
}

function setGuildEnabled(guildId, enabled, details = {}) {
  const id = cleanId(guildId);
  if (!id) return null;
  const state = loadState();
  state.guilds[id] ||= defaultConfigForGuild(id);
  state.guilds[id].enabled = enabled !== false;
  if (state.guilds[id].enabled) delete state.meta.disabledGuilds[id];
  else state.meta.disabledGuilds[id] = {
    guildId: id,
    reason: String(details.reason || '').slice(0, 500),
    disabledBy: String(details.disabledBy || ''),
    disabledAt: Number(details.disabledAt) || Date.now(),
    guildName: String(details.guildName || '').slice(0, 120),
  };
  saveState(state);
  return { config: getGuildConfigRaw(id), disabled: getDisabledGuilds()[id] || null };
}

function isGuildEnabled(guildId) {
  return Boolean(getGuildConfig(guildId));
}

function isGuildFullBotEnabled() {
  return false;
}

function isGuildGag2StockEnabled(guildId) {
  const config = getGuildConfig(guildId);
  return Boolean(config?.features?.gag2Stock && config.gag2Stock?.enabled !== false);
}

function setGuildFeatureAccess(guildId, features = {}) {
  const id = cleanId(guildId);
  if (!id) return null;
  const state = loadState();
  state.guilds[id] ||= defaultConfigForGuild(id);
  state.guilds[id].leveling ||= clone(DEFAULT_LEVELING_CONFIG);
  state.guilds[id].rngGame ||= clone(DEFAULT_RNG_GAME_CONFIG);
  state.guilds[id].features = {
    gag2Stock: true,
    leveling: features.leveling === undefined
      ? state.guilds[id].features?.leveling === true
      : features.leveling === true,
    rngGame: features.rngGame === undefined
      ? state.guilds[id].features?.rngGame === true
      : features.rngGame === true,
    fullBot: false,
  };
  if (!state.guilds[id].features.leveling) state.guilds[id].leveling.enabled = false;
  if (!state.guilds[id].features.rngGame) state.guilds[id].rngGame.enabled = false;
  saveState(state);
  return getGuildConfigRaw(id);
}

function isGuildLevelingEnabled(guildId) {
  const config = getGuildConfig(guildId);
  return Boolean(config?.features?.leveling && config.leveling?.enabled !== false);
}

function isGuildRngGameEnabled(guildId) {
  const config = getGuildConfig(guildId);
  return Boolean(config?.features?.rngGame && config.rngGame?.enabled === true);
}

function updateGuildGag2StockRoleIds(guildId, type, value) {
  const id = cleanId(guildId);
  const key = String(type || '');
  if (!id || !GAG2_STOCK_ROLE_KEYS.includes(key)) return null;
  const state = loadState();
  state.guilds[id] ||= defaultConfigForGuild(id);
  state.guilds[id].gag2Stock = normalizeGag2StockConfig(state.guilds[id].gag2Stock, defaultConfigForGuild(id).gag2Stock);
  state.guilds[id].gag2Stock.roleIds[key] = normalizeRoleIdMap(value);
  state.guilds[id].gag2Stock.rolesSyncedAt = new Date().toISOString();
  saveState(state);
  return getGuildConfigRaw(id);
}

function resolveLoggingChannelId() {
  return '';
}

module.exports = {
  DEFAULT_FEATURES,
  DEFAULT_GAG2_STOCK_CONFIG,
  DEFAULT_LEVELING_CONFIG,
  DEFAULT_RNG_GAME_CONFIG,
  DEFAULT_GUILD_CONFIG,
  DEFAULT_COINSPRITE_GUILD_CONFIG,
  DEFAULT_GUILD_ID,
  DEFAULT_STATE,
  GAG2_STOCK_CHANNEL_KEYS,
  GAG2_FALL_ROLE_KEYS,
  GAG2_FALL_STOCK_TYPES,
  GAG2_ROLE_FILTER_RARITIES,
  GAG2_SELL_FILTER_RARITIES,
  GAG2_SELL_MULTIPLIERS,
  SCHEMA_VERSION,
  STORE_PATH,
  deleteGuildConfig,
  ensureGuildConfig,
  getConfiguredGuildIds,
  getDisabledGuilds,
  getEnabledGuildIds,
  getGuildConfig,
  getGuildConfigRaw,
  getGuildConfigValue,
  isGuildEnabled,
  isGuildFullBotEnabled,
  isGuildGag2StockEnabled,
  isGuildLevelingEnabled,
  isGuildRngGameEnabled,
  loadState,
  normalizeGag2StockConfig,
  normalizeLevelingConfig,
  normalizeRngGameConfig,
  normalizeState,
  resolveLoggingChannelId,
  saveState,
  setGuildEnabled,
  setGuildFeatureAccess,
  updateGuildGag2StockRoleIds,
};
