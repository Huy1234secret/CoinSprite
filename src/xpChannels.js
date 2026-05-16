const XP_CHANNEL_IDS = new Set([
  '1493906607166328872',
  '1495676540875182212',
  '1493907879328088064',
  '1493907677284139099',
  '1493908074669543544',
  '1496256300655317092',
  '1495375260642705488',
]);

function canEarnXpInChannel(channelOrId) {
  const channelId = typeof channelOrId === 'string' ? channelOrId : channelOrId?.id;
  return XP_CHANNEL_IDS.has(String(channelId || ''));
}

module.exports = {
  XP_CHANNEL_IDS,
  canEarnXpInChannel,
};
