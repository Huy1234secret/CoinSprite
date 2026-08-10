function memberRoleIds(member) {
  if (!member) return [];
  if (Array.isArray(member.roles)) return member.roles.map(String);
  if (member.roles?.cache?.keys) return [...member.roles.cache.keys()].map(String);
  if (member.roles?.valueOf instanceof Function) {
    const value = member.roles.valueOf();
    if (Array.isArray(value)) return value.map(String);
  }
  return [];
}

function evaluateRngGameAccess(source, getGuildPolicy) {
  if (typeof getGuildPolicy !== 'function') return { allowed: true, bypassCooldown: false };
  const policy = getGuildPolicy(String(source.guildId || '')) || {};
  if (policy.unlocked !== true) {
    return { allowed: false, reason: 'GAG2 RNG Game is locked for this server. Ask the bot owner to unlock it.' };
  }
  if (policy.enabled !== true) {
    return { allowed: false, reason: 'GAG2 RNG Game is disabled for this server. Ask a server administrator to enable it.' };
  }
  const configuredChannels = Array.isArray(policy.gameChannelIds)
    ? policy.gameChannelIds
    : [policy.gameChannelId];
  const gameChannelIds = [...new Set(configuredChannels.map((channelId) => String(channelId || '')).filter(Boolean))];
  if (!gameChannelIds.length) {
    return { allowed: false, reason: 'GAG2 RNG Game needs at least one game channel. Ask a server administrator to configure one in the dashboard.' };
  }
  const sourceChannelIds = [
    source.channelId,
    source.parentChannelId,
    source.channel?.parentId,
    source.channel?.parent?.id,
  ].map((channelId) => String(channelId || '')).filter(Boolean);
  if (!sourceChannelIds.some((channelId) => gameChannelIds.includes(channelId))) {
    const channelList = gameChannelIds.map((channelId) => `<#${channelId}>`).join(', ');
    return { allowed: false, reason: `GAG2 RNG Game commands are only available in ${channelList}.` };
  }
  const bypassRoles = new Set((policy.cooldownBypassRoleIds || []).map(String));
  return {
    allowed: true,
    bypassCooldown: memberRoleIds(source.member).some((roleId) => bypassRoles.has(roleId)),
  };
}

module.exports = { evaluateRngGameAccess, memberRoleIds };
