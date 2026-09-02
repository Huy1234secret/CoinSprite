const path = require('path');
const { backupFileOnce, readJsonFile, writeJsonAtomic } = require('./jsonFileStore');
const {
  DEFAULT_MESSAGE_TEMPLATES_CONFIG,
  normalizeMessageTemplatesConfig,
} = require('./messageTemplates');
const {
  DEFAULT_REACTION_ROLES_CONFIG,
  normalizeReactionRolesConfig,
} = require('./reactionRoles');

const STORE_PATH = process.env.SERVER_CONFIG_STORE_PATH || path.join(__dirname, '..', 'data', 'server-config.json');
const SCHEMA_VERSION = 23;
const MAX_ADDITIONAL_MESSAGE_CONTAINERS = 2;
const FEATURE_LOCK_RESET_SCHEMA_VERSION = 10;
const DEFAULT_GUILD_ID = cleanId(process.env.DEFAULT_GUILD_ID);
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
    additionalContainers: Object.freeze([]),
  }),
  channelMultipliers: Object.freeze({}),
  roleRewards: Object.freeze([]),
  roleBoosts: Object.freeze([]),
  stackRoleRewards: true,
  xpDrops: Object.freeze({
    enabled: false,
    channelId: '',
    dropTemplate: '## 🎁 {crate_name} appeared!\nBe one of the first **{claim_limit}** members to claim **{xp_min}–{xp_max} XP**.\n-# {claims_left} claim(s) remaining · disappears {despawn_time}',
    claimTemplate: '## ✦ {crate_name} claimed\n{user} found **{xp} XP** and is now level **{level}**.\n-# {claims_left} claim(s) remaining',
    crates: Object.freeze([]),
  }),
});
const DEFAULT_RNG_GAME_CONFIG = Object.freeze({
  enabled: false,
  gameChannelIds: Object.freeze([]),
  cooldownBypassRoleIds: Object.freeze([]),
});
const DEFAULT_COUNTING_CONFIG = Object.freeze({ channelId: '' });
const DEFAULT_MEMBER_MESSAGE_TEMPLATES = Object.freeze({
  join: '## Welcome to {server}, {user}! 🎉\nYou’re member **#{member_count}**. We’re happy to have you here!',
  leave: '## {display_name} has left the server\nThanks for being part of {server}. We now have **{member_count}** members.',
  boost: '## Thank you for boosting, {user}! 💜\n{server} now has **{boost_count} boosts** and is at **Boost Level {boost_level}**.',
});
const DEFAULT_MEMBER_MESSAGE_COLORS = Object.freeze({
  join: '#57f287',
  leave: '#ed4245',
  boost: '#f47fff',
});

function defaultMemberMessageEvent(type) {
  return Object.freeze({
    enabled: false,
    channelId: '',
    template: DEFAULT_MEMBER_MESSAGE_TEMPLATES[type],
    layout: Object.freeze({
      container: true,
      accentColor: DEFAULT_MEMBER_MESSAGE_COLORS[type],
      thumbnailEnabled: false,
      thumbnailUrl: '',
      galleryUrls: Object.freeze([]),
    }),
    additionalContainers: Object.freeze([]),
  });
}

const DEFAULT_MEMBER_MESSAGES_CONFIG = Object.freeze({
  enabled: true,
  join: defaultMemberMessageEvent('join'),
  leave: defaultMemberMessageEvent('leave'),
  boost: defaultMemberMessageEvent('boost'),
});
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const DEFAULT_FEATURES = Object.freeze({
  leveling: false,
  rngGame: false,
  fullBot: false,
});
const DEFAULT_GUILD_CONFIG = Object.freeze({
  enabled: true,
  features: DEFAULT_FEATURES,
  channels: { commandLogThread: '' },
  leveling: DEFAULT_LEVELING_CONFIG,
  memberMessages: DEFAULT_MEMBER_MESSAGES_CONFIG,
  messageTemplates: DEFAULT_MESSAGE_TEMPLATES_CONFIG,
  reactionRoles: DEFAULT_REACTION_ROLES_CONFIG,
  rngGame: DEFAULT_RNG_GAME_CONFIG,
  counting: DEFAULT_COUNTING_CONFIG,
});
const DEFAULT_COINSPRITE_GUILD_CONFIG = DEFAULT_GUILD_CONFIG;
const DEFAULT_STATE = Object.freeze({
  meta: { schemaVersion: SCHEMA_VERSION, disabledGuilds: {} },
  guilds: DEFAULT_GUILD_ID ? { [DEFAULT_GUILD_ID]: DEFAULT_COINSPRITE_GUILD_CONFIG } : {},
});

function cleanId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
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

const MEMBER_MEDIA_VARIABLES = new Set(['{user_avatar}', '{server_icon}']);

function cleanMemberMessageMediaUrl(value) {
  const text = String(value || '').trim();
  return MEMBER_MEDIA_VARIABLES.has(text.toLowerCase()) ? text.toLowerCase() : cleanWebUrl(text);
}

function cleanHexColor(value, fallback = '#b9f547') {
  const text = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
}

function normalizeAdditionalMessageContainers(value, options = {}) {
  const cleanMedia = options.cleanMedia || cleanWebUrl;
  const fallbackColor = options.fallbackColor || '#b9f547';
  const maximumContent = options.maximumContent || 3000;
  return (Array.isArray(value) ? value : []).slice(0, MAX_ADDITIONAL_MESSAGE_CONTAINERS).map((container) => {
    const source = isObject(container) ? container : {};
    const layout = isObject(source.layout) ? source.layout : {};
    return {
      content: String(source.content || '').replace(/\u0000/g, '').slice(0, maximumContent),
      layout: {
        container: true,
        accentColor: cleanHexColor(layout.accentColor, fallbackColor),
        thumbnailEnabled: layout.thumbnailEnabled === true,
        thumbnailUrl: cleanMedia(layout.thumbnailUrl),
        galleryUrls: [...new Set((Array.isArray(layout.galleryUrls) ? layout.galleryUrls : [])
          .map(cleanMedia).filter(Boolean))].slice(0, 10),
      },
    };
  });
}

function cleanXpDropId(value, fallback = '') {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(text) ? text : fallback;
}

function durationSeconds(value, fallback = 0) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === '0') return fallback;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/);
  if (!match) return fallback;
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = Number(match[1]) * multipliers[match[2]];
  return Number.isFinite(seconds) ? Math.round(seconds) : fallback;
}

function cleanDuration(value, fallback, { optional = false } = {}) {
  const text = String(value ?? '').trim().toLowerCase();
  if (optional && (!text || text === '0')) return '';
  const seconds = durationSeconds(text, 0);
  if (seconds < 1 || seconds > 365 * 24 * 60 * 60) return fallback;
  return text.replace(/\s+/g, '');
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
  const xpDropSource = isObject(source.xpDrops) ? source.xpDrops : {};
  const xpDropDefaults = defaults.xpDrops || DEFAULT_LEVELING_CONFIG.xpDrops;
  const seenCrateIds = new Set();
  const crates = (Array.isArray(xpDropSource.crates) ? xpDropSource.crates : xpDropDefaults.crates)
    .map((crate, index) => {
      const fallbackId = `crate-${index + 1}`;
      let id = cleanXpDropId(crate?.id, fallbackId);
      while (seenCrateIds.has(id)) id = `${fallbackId}-${seenCrateIds.size + 1}`.slice(0, 40);
      seenCrateIds.add(id);
      const minimum = clampNumber(crate?.xp?.min ?? crate?.xpMin, 1, 1_000_000, 50);
      const maximum = clampNumber(crate?.xp?.max ?? crate?.xpMax, minimum, 1_000_000, Math.max(minimum, 100));
      return {
        id,
        enabled: crate?.enabled !== false,
        name: String(crate?.name || `Crate ${index + 1}`).trim().slice(0, 80) || `Crate ${index + 1}`,
        imageUrl: cleanWebUrl(crate?.imageUrl),
        xp: { min: minimum, max: maximum },
        channelId: cleanId(crate?.channelId),
        dropEvery: cleanDuration(crate?.dropEvery, '30m'),
        chancePercent: clampNumber(crate?.chancePercent, 0, 100, 100, false),
        claimLimit: clampNumber(crate?.claimLimit, 1, 1000, 1),
        despawnAfter: cleanDuration(crate?.despawnAfter, '', { optional: true }),
        allowMultipleClaims: crate?.allowMultipleClaims === true,
        containerColor: cleanHexColor(crate?.containerColor, '#b9f547'),
      };
    })
    .slice(0, 100);
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
      additionalContainers: normalizeAdditionalMessageContainers(source.announcements?.additionalContainers, {
        cleanMedia: cleanLevelingMediaUrl,
        fallbackColor: cleanHexColor(layoutSource.accentColor, layoutDefaults.accentColor),
      }),
    },
    channelMultipliers,
    roleRewards,
    roleBoosts,
    stackRoleRewards: source.stackRoleRewards === undefined
      ? defaults.stackRoleRewards !== false
      : source.stackRoleRewards !== false,
    xpDrops: {
      enabled: xpDropSource.enabled === undefined ? xpDropDefaults.enabled === true : xpDropSource.enabled === true,
      channelId: cleanId(xpDropSource.channelId),
      dropTemplate: String(xpDropSource.dropTemplate || xpDropDefaults.dropTemplate)
        .trim().slice(0, 3000) || xpDropDefaults.dropTemplate,
      claimTemplate: String(xpDropSource.claimTemplate || xpDropDefaults.claimTemplate)
        .trim().slice(0, 3000) || xpDropDefaults.claimTemplate,
      crates,
    },
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

function normalizeCountingConfig(value) {
  const source = isObject(value) ? value : {};
  return { channelId: cleanId(source.channelId) };
}

function normalizeMemberMessagesConfig(value, defaults = DEFAULT_MEMBER_MESSAGES_CONFIG) {
  const source = isObject(value) ? value : {};
  const normalized = { enabled: source.enabled === undefined ? defaults.enabled !== false : source.enabled !== false };
  for (const type of ['join', 'leave', 'boost']) {
    const eventSource = isObject(source[type]) ? source[type] : {};
    const eventDefaults = isObject(defaults[type]) ? defaults[type] : DEFAULT_MEMBER_MESSAGES_CONFIG[type];
    const layoutSource = isObject(eventSource.layout) ? eventSource.layout : {};
    const layoutDefaults = eventDefaults.layout || DEFAULT_MEMBER_MESSAGES_CONFIG[type].layout;
    normalized[type] = {
      enabled: eventSource.enabled === undefined ? eventDefaults.enabled === true : eventSource.enabled === true,
      channelId: cleanId(eventSource.channelId),
      template: String(eventSource.template || eventDefaults.template || DEFAULT_MEMBER_MESSAGE_TEMPLATES[type])
        .trim().slice(0, 3000) || DEFAULT_MEMBER_MESSAGE_TEMPLATES[type],
      layout: {
        container: layoutSource.container === undefined ? layoutDefaults.container !== false : layoutSource.container !== false,
        accentColor: cleanHexColor(layoutSource.accentColor, layoutDefaults.accentColor || DEFAULT_MEMBER_MESSAGE_COLORS[type]),
        thumbnailEnabled: layoutSource.thumbnailEnabled === true,
        thumbnailUrl: cleanMemberMessageMediaUrl(layoutSource.thumbnailUrl),
        galleryUrls: [...new Set((Array.isArray(layoutSource.galleryUrls) ? layoutSource.galleryUrls : [])
          .map(cleanMemberMessageMediaUrl).filter(Boolean))].slice(0, 10),
      },
      additionalContainers: normalizeAdditionalMessageContainers(eventSource.additionalContainers, {
        cleanMedia: cleanMemberMessageMediaUrl,
        fallbackColor: cleanHexColor(layoutSource.accentColor, layoutDefaults.accentColor || DEFAULT_MEMBER_MESSAGE_COLORS[type]),
      }),
    };
  }
  return normalized;
}

function defaultConfigForGuild() {
  return clone(DEFAULT_GUILD_CONFIG);
}

function normalizeGuildConfig(guildId, value, options = {}) {
  const source = isObject(value) ? value : {};
  const defaults = defaultConfigForGuild(guildId);
  const leveling = normalizeLevelingConfig(source.leveling, defaults.leveling);
  const memberMessages = normalizeMemberMessagesConfig(source.memberMessages, defaults.memberMessages);
  const messageTemplates = normalizeMessageTemplatesConfig(source.messageTemplates);
  const reactionRoles = normalizeReactionRolesConfig(source.reactionRoles);
  const rngGame = normalizeRngGameConfig(source.rngGame, defaults.rngGame);
  const counting = normalizeCountingConfig(source.counting);
  if (options.resetFeatureLocks) {
    leveling.enabled = false;
    rngGame.enabled = false;
  }
  return {
    enabled: source.enabled !== false,
    features: {
      leveling: options.resetFeatureLocks ? false : source.features?.leveling === true,
      rngGame: options.resetFeatureLocks ? false : source.features?.rngGame === true,
      fullBot: false,
    },
    channels: { commandLogThread: cleanId(source.channels?.commandLogThread) },
    leveling,
    memberMessages,
    messageTemplates,
    reactionRoles,
    rngGame,
    counting,
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
  if (DEFAULT_GUILD_ID && !guilds[DEFAULT_GUILD_ID]) {
    guilds[DEFAULT_GUILD_ID] = defaultConfigForGuild(DEFAULT_GUILD_ID);
  }
  return {
    meta: { schemaVersion: SCHEMA_VERSION, disabledGuilds: normalizeDisabledGuilds(source.meta?.disabledGuilds) },
    guilds,
  };
}

function loadState() {
  const raw = readJsonFile(STORE_PATH, { label: 'server configuration', fallback: DEFAULT_STATE });
  const normalized = normalizeState(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    backupFileOnce(STORE_PATH, `${STORE_PATH}.pre-schema-23.bak`);
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
  if (!id || (DEFAULT_GUILD_ID && id === DEFAULT_GUILD_ID)) return false;
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
  return Object.entries(loadState().guilds)
    .filter(([, config]) => includeDisabled || config.enabled)
    .map(([id]) => id);
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

function setGuildFeatureAccess(guildId, features = {}) {
  const id = cleanId(guildId);
  if (!id) return null;
  const state = loadState();
  state.guilds[id] ||= defaultConfigForGuild(id);
  state.guilds[id].leveling ||= clone(DEFAULT_LEVELING_CONFIG);
  state.guilds[id].rngGame ||= clone(DEFAULT_RNG_GAME_CONFIG);
  state.guilds[id].features = {
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

function resolveLoggingChannelId(config, _feature, _type, fallback = '') {
  return cleanId(fallback || config?.channels?.commandLogThread);
}

module.exports = {
  DEFAULT_FEATURES,
  DEFAULT_COUNTING_CONFIG,
  DEFAULT_LEVELING_CONFIG,
  DEFAULT_MEMBER_MESSAGES_CONFIG,
  DEFAULT_MESSAGE_TEMPLATES_CONFIG,
  DEFAULT_REACTION_ROLES_CONFIG,
  DEFAULT_RNG_GAME_CONFIG,
  DEFAULT_GUILD_CONFIG,
  DEFAULT_COINSPRITE_GUILD_CONFIG,
  DEFAULT_GUILD_ID,
  DEFAULT_STATE,
  SCHEMA_VERSION,
  STORE_PATH,
  durationSeconds,
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
  isGuildLevelingEnabled,
  isGuildRngGameEnabled,
  loadState,
  normalizeLevelingConfig,
  normalizeCountingConfig,
  normalizeMemberMessagesConfig,
  normalizeMessageTemplatesConfig,
  normalizeReactionRolesConfig,
  normalizeRngGameConfig,
  normalizeState,
  resolveLoggingChannelId,
  saveState,
  setGuildEnabled,
  setGuildFeatureAccess,
};
