const fs = require('fs');
const path = require('path');
const { DEFAULT_LEVEL_UP_MESSAGE, sanitizeLevelUpMessage } = require('./levelUpMessage');
const { sanitizeWordChainXpFormula } = require('./wordChainFormula');

const STORE_PATH = path.join(__dirname, '..', 'data', 'server-config.json');
const SCHEMA_VERSION = 1;
const DEFAULT_GUILD_ID = process.env.DEFAULT_GUILD_ID || '1493901002519347290';

function xpChannel(channelId, minXp = 1, maxXp = 3, cooldownMs = 0) {
  return { channelId, minXp, maxXp, cooldownMs };
}

const DEFAULT_GUILD_CONFIG = {
  enabled: true,
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
  roles: {
    staff: '1494993523064443065',
    crewMemberPlus: '1495039173260873738',
    utdxCrewMemberPlus: '1507984807680938165',
    onboarding: '1494397171045503129',
    giveawayBlacklist: '1498405208969973840',
    wordChainPunishment: '1512488707461091420',
  },
  xp: {
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
    messageXpMin: 1,
    messageXpMax: 3,
    messageCooldownMs: 0,
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
      invitePoint: '<:InvitePoint:1494571122186915922>',
      clanRerolls: '<:SPCRR:1494572058313625741>',
      traitRerolls: '<:SPTRR:1494572054165323836>',
      raceRerolls: '<:SPRRR:1494572061358555196>',
    },
    tiers: [
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
    ],
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
  giveRoleChoices: {
    utdx_member_plus: {
      label: 'UTDX Member+',
      roleKey: 'utdxCrewMemberPlus',
    },
    sp_member_plus: {
      label: 'SP Member+',
      roleKey: 'crewMemberPlus',
    },
  },
  emojis: {
    giveawayRequestAccept: { id: '1498173245981986869', name: 'Y_' },
    giveawayRequestDeny: { id: '1498173244031631400', name: 'N_' },
  },
};

const DEFAULT_STATE = {
  meta: {
    schemaVersion: SCHEMA_VERSION,
  },
  guilds: {
    [DEFAULT_GUILD_ID]: DEFAULT_GUILD_CONFIG,
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
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`, 'utf8');
  }
}

function normalizeState(rawState) {
  const rawGuilds = isPlainObject(rawState?.guilds) ? rawState.guilds : {};
  const guilds = {};

  if (Object.keys(rawGuilds).length === 0) {
    guilds[DEFAULT_GUILD_ID] = clone(DEFAULT_GUILD_CONFIG);
  } else {
    for (const [guildId, guildConfig] of Object.entries(rawGuilds)) {
      const merged = mergeConfig(DEFAULT_GUILD_CONFIG, guildConfig);
      delete merged.channels.lowXpCategory;
      delete merged.xp.lowXpChannels;
      delete merged.xp.noXpChannels;
      delete merged.xp.lowXpAmount;
      delete merged.xp.levelFunMessages;
      merged.xp.levelUpMessage = sanitizeLevelUpMessage(merged.xp.levelUpMessage);
      merged.wordChain.repeatedWordAction = merged.wordChain.repeatedWordAction === 'warn' ? 'warn' : 'punish';
      merged.wordChain.wrongStartAction = merged.wordChain.wrongStartAction === 'warn' ? 'warn' : 'punish';
      merged.wordChain.xpRewardFormula = sanitizeWordChainXpFormula(merged.wordChain.xpRewardFormula);
      guilds[guildId] = merged;
    }
  }

  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      ...(isPlainObject(rawState?.meta) ? rawState.meta : {}),
    },
    guilds,
  };
}

function loadState() {
  ensureStoreFile();
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8') || '{}'));
  } catch {
    return clone(DEFAULT_STATE);
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf8');
}

function getGuildConfig(guildId) {
  if (!guildId) return null;
  const config = loadState().guilds[String(guildId)];
  if (!config?.enabled) return null;
  return config;
}

function getGuildConfigValue(guildId, selector, fallback = null) {
  const config = getGuildConfig(guildId);
  if (!config || typeof selector !== 'function') return fallback;
  const selected = selector(config);
  return selected === undefined || selected === null ? fallback : selected;
}

function getEnabledGuildIds() {
  return Object.entries(loadState().guilds)
    .filter(([, config]) => config?.enabled)
    .map(([guildId]) => guildId);
}

function isGuildEnabled(guildId) {
  return Boolean(getGuildConfig(guildId));
}

module.exports = {
  DEFAULT_GUILD_CONFIG,
  DEFAULT_GUILD_ID,
  DEFAULT_STATE,
  SCHEMA_VERSION,
  STORE_PATH,
  getEnabledGuildIds,
  getGuildConfig,
  getGuildConfigValue,
  isGuildEnabled,
  loadState,
  saveState,
};
