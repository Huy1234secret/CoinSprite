const { DEFAULT_GUILD_CONFIG, getGuildConfig } = require('./serverConfig');

function normalizeXpChannelRule(rule, xpConfig = DEFAULT_GUILD_CONFIG.xp) {
  if (typeof rule === 'string') {
    return {
      channelId: rule,
      minXp: xpConfig.messageXpMin,
      maxXp: xpConfig.messageXpMax,
      cooldownMs: xpConfig.messageCooldownMs || 0,
    };
  }

  const channelId = String(rule?.channelId || rule?.id || '').trim();
  if (!channelId) return null;
  const minXp = Math.max(0, Number(rule?.minXp ?? xpConfig.messageXpMin) || 0);
  const maxXp = Math.max(minXp, Number(rule?.maxXp ?? xpConfig.messageXpMax) || minXp);
  const cooldownMs = Math.max(0, Math.floor(Number(rule?.cooldownMs ?? xpConfig.messageCooldownMs) || 0));
  return { channelId, minXp, maxXp, cooldownMs };
}

function getXpConfig(guildId) {
  return (getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG).xp;
}

function getDefaultXpRule(xpConfig) {
  return {
    minXp: Math.max(0, Number(xpConfig.messageXpMin) || 0),
    maxXp: Math.max(0, Number(xpConfig.messageXpMax) || 0),
    cooldownMs: Math.max(0, Math.floor(Number(xpConfig.messageCooldownMs) || 0)),
  };
}

function isDefaultRule(rule, xpConfig) {
  const defaults = getDefaultXpRule(xpConfig);
  return rule.minXp === defaults.minXp
    && rule.maxXp === defaults.maxXp
    && rule.cooldownMs === defaults.cooldownMs;
}

function getDefaultXpChannelIds(guildId) {
  const xpConfig = getXpConfig(guildId);
  return [...new Set((xpConfig.channels || [])
    .map((rule) => normalizeXpChannelRule(rule, xpConfig)?.channelId)
    .filter(Boolean))];
}

function getXpChannelOverrides(guildId) {
  const xpConfig = getXpConfig(guildId);
  const hasExplicitOverrides = Object.prototype.hasOwnProperty.call(xpConfig, 'channelOverrides');
  const source = hasExplicitOverrides ? xpConfig.channelOverrides : xpConfig.channels;
  return (source || [])
    .map((rule) => normalizeXpChannelRule(rule, xpConfig))
    .filter((rule) => rule && (hasExplicitOverrides || (typeof rule !== 'string' && !isDefaultRule(rule, xpConfig))));
}

function getXpChannelRules(guildId) {
  const xpConfig = getXpConfig(guildId);
  const overrides = getXpChannelOverrides(guildId);
  const overrideIds = new Set(overrides.map((rule) => rule.channelId));
  const defaults = getDefaultXpRule(xpConfig);
  return [
    ...overrides,
    ...getDefaultXpChannelIds(guildId)
      .filter((channelId) => !overrideIds.has(channelId))
      .map((channelId) => ({ channelId, ...defaults })),
  ];
}

const XP_CHANNEL_IDS = new Set(getXpChannelRules().map((rule) => rule.channelId));
const LOW_XP_CHANNEL_IDS = new Set();

function getGuildId(channelOrId, guildId) {
  return guildId || (typeof channelOrId === 'string' ? null : channelOrId?.guildId);
}

function getChannelId(channelOrId) {
  return typeof channelOrId === 'string' ? channelOrId : channelOrId?.id;
}

function getAncestorChannelIds(channelOrId) {
  if (typeof channelOrId === 'string') return [];
  return [
    channelOrId?.parentId,
    channelOrId?.parent?.parentId,
  ].map((id) => String(id || '')).filter(Boolean);
}

function getCandidateChannelIds(channelOrId) {
  return [String(getChannelId(channelOrId) || ''), ...getAncestorChannelIds(channelOrId)].filter(Boolean);
}

function getXpChannelRule(channelOrId, guildId) {
  const resolvedGuildId = getGuildId(channelOrId, guildId);
  const xpConfig = getXpConfig(resolvedGuildId);
  const overrides = getXpChannelOverrides(resolvedGuildId);
  const defaultChannelIds = new Set(getDefaultXpChannelIds(resolvedGuildId));
  const defaults = getDefaultXpRule(xpConfig);

  for (const candidateId of getCandidateChannelIds(channelOrId)) {
    const matchingOverride = overrides.find((rule) => rule.channelId === candidateId);
    if (matchingOverride) return matchingOverride;
    if (defaultChannelIds.has(candidateId)) return { channelId: candidateId, ...defaults };
  }
  return null;
}

function canEarnXpInChannel(channelOrId, guildId) {
  return Boolean(getXpChannelRule(channelOrId, guildId));
}

module.exports = {
  XP_CHANNEL_IDS,
  LOW_XP_CHANNEL_IDS,
  canEarnXpInChannel,
  getDefaultXpChannelIds,
  getXpChannelOverrides,
  getXpChannelRule,
  getXpChannelRules,
};
