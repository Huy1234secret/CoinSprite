const LOW_XP_CHANNEL_IDS = new Set([
  '1503763557421154447',
  '1498299976781135893',
  '1498299950235390156',
]);

const XP_CHANNEL_IDS = new Set([
  '1493906607166328872',
  '1495676540875182212',
  '1493907879328088064',
  '1493907677284139099',
  '1493908074669543544',
  '1496256300655317092',
  '1495375260642705488',
  ...LOW_XP_CHANNEL_IDS,
]);

function getChannelId(channelOrId) {
  return typeof channelOrId === 'string' ? channelOrId : channelOrId?.id;
}

function getParentChannelId(channelOrId) {
  return typeof channelOrId === 'string' ? null : channelOrId?.parentId;
}

function canEarnXpInChannel(channelOrId) {
  const channelId = getChannelId(channelOrId);
  return XP_CHANNEL_IDS.has(String(channelId || ''));
}

function isLowXpChannel(channelOrId) {
  const channelId = getChannelId(channelOrId);
  const parentId = getParentChannelId(channelOrId);
  return LOW_XP_CHANNEL_IDS.has(String(channelId || '')) || LOW_XP_CHANNEL_IDS.has(String(parentId || ''));
}

module.exports = {
  XP_CHANNEL_IDS,
  LOW_XP_CHANNEL_IDS,
  canEarnXpInChannel,
  isLowXpChannel,
};
