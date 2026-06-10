const { DEFAULT_GUILD_CONFIG, getGuildConfig } = require('./serverConfig');

const LOW_XP_CHANNEL_IDS = new Set(DEFAULT_GUILD_CONFIG.xp.lowXpChannels);
const XP_CHANNEL_IDS = new Set(DEFAULT_GUILD_CONFIG.xp.channels);

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
  const xpConfig = getXpConfig(getGuildId(channelOrId, guildId));
  const channelId = getChannelId(channelOrId);
  return new Set(xpConfig.channels || []).has(String(channelId || ''));
}

function isLowXpChannel(channelOrId, guildId) {
  const xpConfig = getXpConfig(getGuildId(channelOrId, guildId));
  const lowXpChannelIds = new Set(xpConfig.lowXpChannels || []);
  const channelId = getChannelId(channelOrId);
  const parentId = getParentChannelId(channelOrId);
  return lowXpChannelIds.has(String(channelId || '')) || lowXpChannelIds.has(String(parentId || ''));
}

module.exports = {
  XP_CHANNEL_IDS,
  LOW_XP_CHANNEL_IDS,
  canEarnXpInChannel,
  isLowXpChannel,
};
