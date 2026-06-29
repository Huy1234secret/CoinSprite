const fs = require('fs');
const path = require('path');
const { backupFileOnce, readJsonFile, writeJsonAtomic } = require('./jsonFileStore');
const { DEFAULT_LEVEL_UP_MESSAGE, sanitizeLevelUpMessage } = require('./levelUpMessage');
const {
  DEFAULT_TICKETS_CONFIG,
  LEGACY_DEFAULT_TICKET_TYPES,
  clone: cloneTicketValue,
  sanitizeTicketsConfig,
} = require('./ticketConfig');
const { sanitizeWordChainXpFormula } = require('./wordChainFormula');
const { DEFAULT_APPEAL_CONFIG, sanitizeAppealConfig } = require('./appealConfig');
const { sanitizeCommunityMessages } = require('./communityMessageConfig');

const STORE_PATH = path.join(__dirname, '..', 'data', 'server-config.json');
const SCHEMA_VERSION = 5;
const DEFAULT_GUILD_ID = process.env.DEFAULT_GUILD_ID || '1493901002519347290';

function xpChannel(channelId, minXp = 1, maxXp = 3, cooldownMs = 0) {
  return { channelId, minXp, maxXp, cooldownMs };
}

const GIVE_ROLE_CHOICES = {
  utdx_member_plus: {
    label: 'UTDX Member+',
    roleKey: 'utdxCrewMemberPlus',
  },
  sp_member_plus: {
    label: 'SP Member+',
    roleKey: 'crewMemberPlus',
  },
};

const INVITE_REWARD_TIERS = [
  {
    minMembers: 50,
    maxMembers: null,
    label: '50+',
    rewards: { clanRerolls: 1000, raceRerolls: 150, traitRerolls: 150 },
  },
  {
    minMembers: 30,
    maxMembers: 49,
    label: '30 - 49',
    rewards: { clanRerolls: 500, raceRerolls: 135, traitRerolls: 135 },
  },
  {
    minMembers: 0,
    maxMembers: 29,
    label: '0 - 29',
    rewards: { clanRerolls: 250, raceRerolls: 120, traitRerolls: 120 },
  },
];

const DEFAULT_SPAM_AUTOMOD = {
  enabled: false,
  messages: { enabled: true, count: 6, durationSeconds: 5 },
  lines: { enabled: true, maxLines: 12 },
  mentions: { enabled: true, maxMentions: 6 },
  deleteMessage: true,
  action: 'timeout',
  timeoutSeconds: 300,
  excludeChannelIds: [],
  excludeRoleIds: [],
  logChannelId: '',
};

const DEFAULT_COMMUNITY_MESSAGE_TEXT = {
  welcome: {
    enabled: false,
    channelId: '',
    message: 'Welcome <@mention> to **<server-name>**! You are member **<member-count>**.',
  },
  goodbye: {
    enabled: false,
    channelId: '',
    message: '**<display-name>** has left **<server-name>**.',
  },
  booster: {
    enabled: false,
    channelId: '',
    message: 'Thank you <@mention> for boosting **<server-name>**!',
  },
};

const DEFAULT_COMMUNITY_MESSAGES = sanitizeCommunityMessages(DEFAULT_COMMUNITY_MESSAGE_TEXT);

const DEFAULT_LINK_AUTOMOD = {
  enabled: false,
  blockDiscordInvites: true,
  allowedInviteGuildIds: [],
  allowedInviteCodes: [],
  domainBlacklist: [],
  domainWhitelist: [],
  scanChannelIds: [],
  excludeChannelIds: [],
  excludeRoleIds: [],
  actions: [
    { type: 'delete' },
    { type: 'log' },
  ],
};

function warningRuleReason(threshold, action, value = '') {
  const saved = String(value || '').trim();
  if (saved) return saved.slice(0, 500);
  const actionLabel = action === 'timeout' ? 'mute' : action === 'staff_alert' ? 'staff alert' : action;
  return ('Reached ' + threshold + ' active warnings. Action: ' + actionLabel + '.').slice(0, 500);
}

const DEFAULT_WARNING_RULES = [
  { threshold: 3, action: 'timeout', durationSeconds: 60 * 60, reason: warningRuleReason(3, 'timeout'), enabled: true },
  { threshold: 5, action: 'timeout', durationSeconds: 24 * 60 * 60, reason: warningRuleReason(5, 'timeout'), enabled: true },
  { threshold: 8, action: 'timeout', durationSeconds: 7 * 24 * 60 * 60, reason: warningRuleReason(8, 'timeout'), enabled: true },
  { threshold: 10, action: 'staff_alert', durationSeconds: 0, reason: warningRuleReason(10, 'staff_alert'), enabled: true },
];

const DEFAULT_LOGGING = {
  categories: {
    moderation: { defaultChannelId: '', eventOverrides: { ai_low: '', ai_severe: '', warning: '', action: '', spam: '' } },
    commands: { defaultChannelId: '', eventOverrides: {} },
    requests: { defaultChannelId: '', eventOverrides: { role_review: '', giveaway_review: '' } },
    invites: { defaultChannelId: '', eventOverrides: {} },
    transcripts: { defaultChannelId: '', eventOverrides: {} },
    background: { defaultChannelId: '', eventOverrides: {} },
  },
};

function cloneLogging(value) { return JSON.parse(JSON.stringify(value)); }

const DEFAULT_GUILD_CONFIG = {
  enabled: true,
  channels: {
    transcript: '',
    ticketPanel: '',
    ticketCategory: '',
    roleRequestReview: '',
    giveawayRequestReview: '',
    inviteRules: '',
    inviteClaim: '',
    inviteLog: '',
    inviteAnnounce: '',
    levelUp: '',
    backgroundLogThread: '',
    wordChain: '',
    giveawayAnnouncement: '',
    commandLogThread: '',
  },
  logging: cloneLogging(DEFAULT_LOGGING),
  roles: {
    staff: '',
    crewMemberPlus: '',
    utdxCrewMemberPlus: '',
    onboarding: '',
    giveawayBlacklist: '',
    wordChainPunishment: '',
  },
  moderation: {
    ai: {
      enabled: false,
      logChannelId: '', // Legacy fallback for configurations saved before severity routing.
      lowSeverityLogChannelId: '',
      severeLogChannelId: '',
      scanChannelIds: [],
      excludeRoleIds: [],
      alertTemplateId: 'default-ai-moderation-alert',
      maxInputChars: 1500,
    },
    auto: {
      link: DEFAULT_LINK_AUTOMOD,
      spam: DEFAULT_SPAM_AUTOMOD,
    },
    warnings: {
      enabled: false,
      defaultExpiryDays: 90,
      fallbackChannelId: '',
      staffLogChannelId: '',
      escalationRules: DEFAULT_WARNING_RULES,
    },
    appeals: DEFAULT_APPEAL_CONFIG,
  },
  communityMessages: DEFAULT_COMMUNITY_MESSAGES,
  xp: {
    channels: [],
    messageXpMin: 1,
    messageXpMax: 3,
    messageCooldownMs: 0,
    levelUpMessage: {
      ...DEFAULT_LEVEL_UP_MESSAGE,
      enabled: false,
    },
    boosts: [],
    levelRoleRewards: [],
    punishmentDurationsMs: {
      1: 24 * 60 * 60 * 1000,
      2: 3 * 24 * 60 * 60 * 1000,
      3: 7 * 24 * 60 * 60 * 1000,
    },
  },
  inviteRewards: {
    enabled: false,
    capMembers: 150,
    emojis: {
      invitePoint: '',
      clanRerolls: '',
      traitRerolls: '',
      raceRerolls: '',
    },
    tiers: INVITE_REWARD_TIERS,
  },
  wordChain: {
    minWordLength: 3,
    maxWordLength: 10,
    startingHearts: 3,
    turnTimeoutMs: 4 * 60 * 60 * 1000,
    punishmentMs: 60 * 1000,
    gameCooldownMs: 60 * 1000,
    repeatedWordAction: 'punish',
    wrongStartAction: 'punish',
    xpRewardFormula: 'wordLength',
  },
  giveaway: {
    minClaimMs: 5 * 60 * 1000,
    maxClaimMs: 24 * 60 * 60 * 1000,
    minDurationMs: 60 * 1000,
    maxDurationMs: 30 * 24 * 60 * 60 * 1000,
  },
  giveRoleChoices: GIVE_ROLE_CHOICES,
  emojis: {
    giveawayRequestAccept: { name: '✅' },
    giveawayRequestDeny: { name: '❌' },
  },
  tickets: {
    ...cloneTicketValue(DEFAULT_TICKETS_CONFIG),
    enabled: false,
    types: [],
  },
};

const DEFAULT_COINSPRITE_GUILD_CONFIG = {
  ...DEFAULT_GUILD_CONFIG,
  channels: {
    transcript: '1495788766600757418',
    ticketPanel: '1493971939545583836',
    ticketCategory: '1493971752680947802',
    roleRequestReview: '1495714584437329940',
    giveawayRequestReview: '1498546607686291558',
    inviteRules: process.env.INVITATION_RULES_CHANNEL_ID || '1494329296670425279',
    inviteClaim: '1493971939545583836',
    inviteLog: '1493915942047059999',
    inviteAnnounce: '1494322475117445383',
    levelUp: '1493909588775272448',
    backgroundLogThread: '1502296881395536033',
    wordChain: '1512480152410525958',
    giveawayAnnouncement: '1493927942546259969',
    commandLogThread: '1495783372591730750',
  },
  logging: {
    categories: {
      moderation: {
        defaultChannelId: '',
        eventOverrides: {
          ai_low: '1516856053751353464',
          ai_severe: '1516855502749962420',
          warning: '',
          action: '',
        },
      },
      commands: { defaultChannelId: '1495783372591730750', eventOverrides: {} },
      requests: {
        defaultChannelId: '',
        eventOverrides: {
          role_review: '1495714584437329940',
          giveaway_review: '1498546607686291558',
        },
      },
      invites: { defaultChannelId: '1493915942047059999', eventOverrides: {} },
      transcripts: { defaultChannelId: '1495788766600757418', eventOverrides: {} },
      background: { defaultChannelId: '1502296881395536033', eventOverrides: {} },
    },
  },
  moderation: {
    ...DEFAULT_GUILD_CONFIG.moderation,
    ai: {
      ...DEFAULT_GUILD_CONFIG.moderation.ai,
      lowSeverityLogChannelId: '1516856053751353464',
      severeLogChannelId: '1516855502749962420',
    },
  },
  roles: {
    staff: '1494993523064443065',
    crewMemberPlus: '1495039173260873738',
    utdxCrewMemberPlus: '1507984807680938165',
    onboarding: '1494397171045503129',
    giveawayBlacklist: '1498405208969973840',
    wordChainPunishment: '1512488707461091420',
  },
  xp: {
    ...DEFAULT_GUILD_CONFIG.xp,
    channels: [
      xpChannel('1493906607166328872'),
      xpChannel('1495676540875182212'),
      xpChannel('1493907879328088064'),
      xpChannel('1493907677284139099'),
      xpChannel('1493908074669543544'),
      xpChannel('1496256300655317092'),
      xpChannel('1495375260642705488'),
      xpChannel('1507985673871687823'),
      xpChannel('1503763557421154447', 0.5, 0.5),
      xpChannel('1498299976781135893', 0.5, 0.5),
      xpChannel('1498299950235390156', 0.5, 0.5),
    ],
    levelUpMessage: DEFAULT_LEVEL_UP_MESSAGE,
    boosts: [
      { roleId: '1502905486645788713', xpPercent: 10 },
      { roleId: '1502905217945964596', xpPercent: 5 },
      { roleId: '1493911895634084042', xpPercent: 25 },
    ],
    levelRoleRewards: [
      { level: 5, roleId: '1493906016570572801' },
      { level: 10, roleId: '1493906102990147654' },
      { level: 15, roleId: '1493906169054625792' },
      { level: 20, roleId: '1493906220065619988' },
      { level: 30, roleId: '1493906329465655376' },
      { level: 40, roleId: '1496480275352391680' },
      { level: 50, roleId: '1502908550253510756' },
      { level: 60, roleId: '1513347125910442055' },
      { level: 70, roleId: '1513347126208364655' },
      { level: 80, roleId: '1513347126518616064' },
      { level: 90, roleId: '1513347127038705745' },
      { level: 100, roleId: '1513347127810719866' },
    ],
  },
  inviteRewards: {
    ...DEFAULT_GUILD_CONFIG.inviteRewards,
    emojis: {
      invitePoint: '<:InvitePoint:1494571122186915922>',
      clanRerolls: '<:SPCRR:1494572058313625741>',
      traitRerolls: '<:SPTRR:1494572054165323836>',
      raceRerolls: '<:SPRRR:1494572061358555196>',
    },
  },
  emojis: {
    giveawayRequestAccept: { id: '1498173245981986869', name: 'Y_' },
    giveawayRequestDeny: { id: '1498173244031631400', name: 'N_' },
  },
  tickets: {
    ...cloneTicketValue(DEFAULT_TICKETS_CONFIG),
    types: cloneTicketValue(LEGACY_DEFAULT_TICKET_TYPES),
  },
};

const DEFAULT_STATE = {
  meta: {
    schemaVersion: SCHEMA_VERSION,
    disabledGuilds: {},
  },
  guilds: {
    [DEFAULT_GUILD_ID]: DEFAULT_COINSPRITE_GUILD_CONFIG,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(defaultValue, overrideValue) {
  if (Array.isArray(defaultValue)) {
    return Array.isArray(overrideValue) ? clone(overrideValue) : clone(defaultValue);
  }

  if (isPlainObject(defaultValue)) {
    const merged = {};
    const override = isPlainObject(overrideValue) ? overrideValue : {};
    for (const key of Object.keys(defaultValue)) {
      merged[key] = mergeConfig(defaultValue[key], override[key]);
    }
    for (const key of Object.keys(override)) {
      if (!(key in merged)) merged[key] = clone(override[key]);
    }
    return merged;
  }

  return overrideValue === undefined ? defaultValue : overrideValue;
}

function ensureStoreFile() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  if (!fs.existsSync(STORE_PATH)) writeJsonAtomic(STORE_PATH, DEFAULT_STATE);
}

function cleanChannelId(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}

function normalizeLogging(rawLogging, legacyChannels = {}, legacyModeration = {}, defaults = DEFAULT_LOGGING) {
  const merged = mergeConfig(defaults, rawLogging);
  const categories = merged.categories || {};
  const explicit = rawLogging?.categories || {};
  const fallback = {
    moderation: {
      defaultChannelId: legacyModeration?.warnings?.staffLogChannelId,
      eventOverrides: {
        ai_low: legacyModeration?.ai?.lowSeverityLogChannelId || legacyModeration?.ai?.logChannelId,
        ai_severe: legacyModeration?.ai?.severeLogChannelId || legacyModeration?.ai?.logChannelId,
        warning: legacyModeration?.warnings?.staffLogChannelId,
      },
    },
    commands: { defaultChannelId: legacyChannels.commandLogThread, eventOverrides: {} },
    requests: {
      defaultChannelId: '',
      eventOverrides: {
        role_review: legacyChannels.roleRequestReview,
        giveaway_review: legacyChannels.giveawayRequestReview,
      },
    },
    invites: { defaultChannelId: legacyChannels.inviteLog, eventOverrides: {} },
    transcripts: { defaultChannelId: legacyChannels.transcript, eventOverrides: {} },
    background: { defaultChannelId: legacyChannels.backgroundLogThread, eventOverrides: {} },
  };
  for (const [category, value] of Object.entries(categories)) {
    const configured = explicit[category] || {};
    value.defaultChannelId = cleanChannelId(configured.defaultChannelId || fallback[category]?.defaultChannelId || value.defaultChannelId);
    value.eventOverrides ||= {};
    const keys = new Set([...Object.keys(value.eventOverrides), ...Object.keys(fallback[category]?.eventOverrides || {})]);
    for (const event of keys) {
      value.eventOverrides[event] = cleanChannelId(
        configured.eventOverrides?.[event] || fallback[category]?.eventOverrides?.[event] || value.eventOverrides[event],
      );
    }
  }
  return { categories };
}

function resolveLoggingChannelId(configOrGuildId, category, event = '', legacyFallback = '') {
  const config = typeof configOrGuildId === 'string' ? getGuildConfig(configOrGuildId) : configOrGuildId;
  const route = config?.logging?.categories?.[category] || {};
  return cleanChannelId(route.eventOverrides?.[event] || route.defaultChannelId || legacyFallback);
}

function normalizeGuildConfig(guildId, guildConfig, defaults) {
  const merged = mergeConfig(defaults, guildConfig);
  delete merged.channels.lowXpCategory;
  delete merged.xp.lowXpChannels;
  delete merged.xp.noXpChannels;
  delete merged.xp.lowXpAmount;
  delete merged.xp.levelFunMessages;
  merged.enabled = guildConfig?.enabled === false ? false : true;
  merged.logging = normalizeLogging(guildConfig?.logging, merged.channels, merged.moderation, defaults.logging || DEFAULT_LOGGING);
  merged.xp.levelUpMessage = sanitizeLevelUpMessage(merged.xp.levelUpMessage, defaults.xp.levelUpMessage);
  const spam = merged.moderation.auto.spam || {};
  spam.enabled = Boolean(spam.enabled);
  spam.messages = {
    enabled: spam.messages?.enabled !== false,
    count: Math.max(2, Math.min(50, Math.round(Number(spam.messages?.count) || 6))),
    durationSeconds: Math.max(1, Math.min(120, Math.round(Number(spam.messages?.durationSeconds) || 5))),
  };
  spam.lines = {
    enabled: spam.lines?.enabled !== false,
    maxLines: Math.max(2, Math.min(100, Math.round(Number(spam.lines?.maxLines) || 12))),
  };
  spam.mentions = {
    enabled: spam.mentions?.enabled !== false,
    maxMentions: Math.max(2, Math.min(100, Math.round(Number(spam.mentions?.maxMentions) || 6))),
  };
  spam.deleteMessage = spam.deleteMessage !== false;
  spam.action = ['none', 'warn', 'timeout'].includes(spam.action) ? spam.action : 'timeout';
  spam.timeoutSeconds = Math.max(60, Math.min(2419200, Math.round(Number(spam.timeoutSeconds) || 300)));
  spam.excludeChannelIds = [...new Set((Array.isArray(spam.excludeChannelIds) ? spam.excludeChannelIds : []).map(cleanChannelId).filter(Boolean))];
  spam.excludeRoleIds = [...new Set((Array.isArray(spam.excludeRoleIds) ? spam.excludeRoleIds : []).map((value) => String(value || '').trim()).filter((value) => /^\d{16,20}$/.test(value)))];
  spam.logChannelId = cleanChannelId(spam.logChannelId);

  merged.communityMessages = sanitizeCommunityMessages(guildConfig?.communityMessages ?? merged.communityMessages);
  merged.moderation.appeals = sanitizeAppealConfig(merged.moderation.appeals);

  const warnings = merged.moderation.warnings;
  warnings.enabled = Boolean(warnings.enabled);
  warnings.defaultExpiryDays = Math.max(0, Math.min(3650, Number(warnings.defaultExpiryDays) || 90));
  warnings.fallbackChannelId = String(warnings.fallbackChannelId || '');
  warnings.staffLogChannelId = String(warnings.staffLogChannelId || '');
  warnings.escalationRules = (Array.isArray(warnings.escalationRules) ? warnings.escalationRules : DEFAULT_WARNING_RULES)
    .map((rule) => {
      const threshold = Math.max(1, Math.min(100, Math.round(Number(rule?.threshold) || 1)));
      const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule?.action) ? rule.action : 'staff_alert';
      return {
        threshold,
        action,
        durationSeconds: Math.max(0, Math.min(2419200, Number(rule?.durationSeconds) || 0)),
        reason: warningRuleReason(threshold, action, rule?.reason),
        enabled: rule?.enabled !== false,
      };
    })
    .sort((a, b) => a.threshold - b.threshold);
  merged.wordChain.repeatedWordAction = merged.wordChain.repeatedWordAction === 'warn' ? 'warn' : 'punish';
  merged.wordChain.wrongStartAction = merged.wordChain.wrongStartAction === 'warn' ? 'warn' : 'punish';
  merged.wordChain.xpRewardFormula = sanitizeWordChainXpFormula(merged.wordChain.xpRewardFormula);
  merged.tickets = sanitizeTicketsConfig(merged.tickets, defaults.tickets);
  return merged;
}

function normalizeDisabledGuilds(value) {
  const source = isPlainObject(value) ? value : {};
  const disabledGuilds = {};
  for (const [guildId, record] of Object.entries(source)) {
    if (!/^\d{16,20}$/.test(guildId)) continue;
    disabledGuilds[guildId] = {
      guildId,
      reason: String(record?.reason || '').slice(0, 500),
      disabledBy: String(record?.disabledBy || ''),
      disabledAt: Number(record?.disabledAt) || Date.now(),
      guildName: String(record?.guildName || '').slice(0, 120),
    };
  }
  return disabledGuilds;
}

function normalizeState(rawState) {
  const rawGuilds = isPlainObject(rawState?.guilds) ? rawState.guilds : {};
  const guilds = {};

  for (const [guildId, guildConfig] of Object.entries(rawGuilds)) {
    const defaults = guildId === DEFAULT_GUILD_ID
      ? DEFAULT_COINSPRITE_GUILD_CONFIG
      : DEFAULT_GUILD_CONFIG;
    guilds[guildId] = normalizeGuildConfig(guildId, guildConfig, defaults);
  }

  if (!guilds[DEFAULT_GUILD_ID]) {
    guilds[DEFAULT_GUILD_ID] = clone(DEFAULT_COINSPRITE_GUILD_CONFIG);
  }

  const disabledGuilds = normalizeDisabledGuilds(rawState?.meta?.disabledGuilds);
  for (const [guildId, config] of Object.entries(guilds)) {
    if (config?.enabled === false && !disabledGuilds[guildId]) {
      disabledGuilds[guildId] = { guildId, reason: '', disabledBy: '', disabledAt: Date.now(), guildName: '' };
    }
  }

  return {
    meta: {
      ...(isPlainObject(rawState?.meta) ? rawState.meta : {}),
      schemaVersion: SCHEMA_VERSION,
      disabledGuilds,
    },
    guilds,
  };
}

function writeState(state) {
  writeJsonAtomic(STORE_PATH, state);
}

function loadState() {
  ensureStoreFile();
  const rawState = readJsonFile(STORE_PATH, { label: 'Server configuration' });
  const sourceVersion = Number(rawState?.meta?.schemaVersion) || 0;
  const normalized = normalizeState(rawState);
  if (JSON.stringify(rawState) !== JSON.stringify(normalized)) {
    if (sourceVersion < SCHEMA_VERSION) backupFileOnce(STORE_PATH, STORE_PATH + '.v' + sourceVersion + '.bak');
    writeState(normalized);
  }
  return normalized;
}

function saveState(state) {
  writeState(normalizeState(state));
}

function defaultConfigForGuild(id) {
  return clone(id === DEFAULT_GUILD_ID ? DEFAULT_COINSPRITE_GUILD_CONFIG : DEFAULT_GUILD_CONFIG);
}

function ensureGuildConfig(guildId) {
  const id = String(guildId || '').trim();
  if (!/^\d{16,20}$/.test(id)) return null;
  const state = loadState();
  if (!state.guilds[id]) {
    state.guilds[id] = defaultConfigForGuild(id);
    saveState(state);
  }
  return state.guilds[id];
}

function deleteGuildConfig(guildId) {
  const id = String(guildId || '').trim();
  if (!id || id === DEFAULT_GUILD_ID) return false;
  const state = loadState();
  if (!state.guilds[id]) return false;
  delete state.guilds[id];
  delete state.meta.disabledGuilds?.[id];
  saveState(state);
  return true;
}

function getGuildConfigRaw(guildId) {
  if (!guildId) return null;
  return loadState().guilds[String(guildId)] || null;
}

function getGuildConfig(guildId) {
  const config = getGuildConfigRaw(guildId);
  if (!config?.enabled) return null;
  return config;
}

function getGuildConfigValue(guildId, selector, fallback = null) {
  const config = getGuildConfig(guildId);
  if (!config || typeof selector !== 'function') return fallback;
  const selected = selector(config);
  return selected === undefined || selected === null ? fallback : selected;
}

function getConfiguredGuildIds({ includeDisabled = false } = {}) {
  return Object.entries(loadState().guilds)
    .filter(([, config]) => includeDisabled || config?.enabled)
    .map(([guildId]) => guildId);
}

function getEnabledGuildIds() {
  return getConfiguredGuildIds();
}

function getDisabledGuilds() {
  return clone(loadState().meta?.disabledGuilds || {});
}

function setGuildEnabled(guildId, enabled, details = {}) {
  const id = String(guildId || '').trim();
  if (!/^\d{16,20}$/.test(id)) return null;
  const state = loadState();
  state.guilds[id] ||= defaultConfigForGuild(id);
  state.guilds[id].enabled = enabled !== false;
  state.meta ||= { schemaVersion: SCHEMA_VERSION };
  state.meta.disabledGuilds ||= {};
  if (state.guilds[id].enabled) {
    delete state.meta.disabledGuilds[id];
  } else {
    state.meta.disabledGuilds[id] = {
      guildId: id,
      reason: String(details.reason || '').trim().slice(0, 500),
      disabledBy: String(details.disabledBy || ''),
      disabledAt: Number(details.disabledAt) || Date.now(),
      guildName: String(details.guildName || '').slice(0, 120),
    };
  }
  saveState(state);
  return {
    config: getGuildConfigRaw(id),
    disabled: getDisabledGuilds()[id] || null,
  };
}

function isGuildEnabled(guildId) {
  return Boolean(getGuildConfig(guildId));
}

module.exports = {
  DEFAULT_COMMUNITY_MESSAGES,
  DEFAULT_GUILD_CONFIG,
  DEFAULT_LOGGING,
  DEFAULT_SPAM_AUTOMOD,
  DEFAULT_WARNING_RULES,
  DEFAULT_COINSPRITE_GUILD_CONFIG,
  DEFAULT_GUILD_ID,
  DEFAULT_STATE,
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
  loadState,
  normalizeLogging,
  resolveLoggingChannelId,
  saveState,
  setGuildEnabled,
};
