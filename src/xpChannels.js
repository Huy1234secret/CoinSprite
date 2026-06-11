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

function getXpChannelRules(guildId) {
  const xpConfig = getXpConfig(guildId);
  return (xpConfig.channels || [])
    .map((rule) => normalizeXpChannelRule(rule, xpConfig))
    .filter(Boolean);
}

const XP_CHANNEL_IDS = new Set(getXpChannelRules().map((rule) => rule.channelId));
const LOW_XP_CHANNEL_IDS = new Set();

function getXpConfig(guildId) {
  return (getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG).xp;
}

function getGuildId(channelOrId, guildId) {
  return guildId || (typeof channelOrId === 'string' ? null : channelOrId?.guildId);
}

function getChannelId(channelOrId) {
  return typeof channelOrId === 'string' ? channelOrId : channelOrId?.id;
}

function getParentChannelId(channelOrId) {
  return typeof channelOrId === 'string' ? null : channelOrId?.parentId;
}

function canEarnXpInChannel(channelOrId, guildId) {
  const channelId = getChannelId(channelOrId);
  const parentId = getParentChannelId(channelOrId);
  return getXpChannelRules(getGuildId(channelOrId, guildId))
    .some((rule) => rule.channelId === String(channelId || '') || rule.channelId === String(parentId || ''));
}

function getXpChannelRule(channelOrId, guildId) {
  const channelId = getChannelId(channelOrId);
  const parentId = getParentChannelId(channelOrId);
  return getXpChannelRules(getGuildId(channelOrId, guildId))
    .find((rule) => rule.channelId === String(channelId || '') || rule.channelId === String(parentId || '')) || null;
}

module.exports = {
  XP_CHANNEL_IDS,
  LOW_XP_CHANNEL_IDS,
  canEarnXpInChannel,
  getXpChannelRule,
  getXpChannelRules,
};
