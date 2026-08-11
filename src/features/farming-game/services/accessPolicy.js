function evaluateFarmingGameAccess(source, getGuildPolicy) {
  if (typeof getGuildPolicy !== 'function') return { allowed: true };
  const policy = getGuildPolicy(String(source.guildId || '')) || {};
  if (policy.unlocked !== true) {
    return { allowed: false, reason: 'Farming Game is locked for this server. Ask the bot owner to unlock it.' };
  }
  if (policy.enabled !== true) {
    return { allowed: false, reason: 'Farming Game is disabled for this server. Ask a server administrator to enable it.' };
  }
  const configuredChannels = Array.isArray(policy.gameChannelIds)
    ? policy.gameChannelIds
    : [policy.gameChannelId];
  const gameChannelIds = [...new Set(configuredChannels.map((channelId) => String(channelId || '')).filter(Boolean))];
  if (!gameChannelIds.length) {
    return { allowed: false, reason: 'Farming Game needs at least one game channel. Ask a server administrator to configure one in the dashboard.' };
  }
  const sourceChannelIds = [
    source.channelId,
    source.parentChannelId,
    source.channel?.parentId,
    source.channel?.parent?.id,
  ].map((channelId) => String(channelId || '')).filter(Boolean);
  if (!sourceChannelIds.some((channelId) => gameChannelIds.includes(channelId))) {
    const channelList = gameChannelIds.map((channelId) => `<#${channelId}>`).join(', ');
    return { allowed: false, reason: `Farming Game commands are only available in ${channelList}.` };
  }
  return { allowed: true };
}

module.exports = { evaluateFarmingGameAccess };
