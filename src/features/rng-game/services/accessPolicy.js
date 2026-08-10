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
  const gameChannelId = String(policy.gameChannelId || '');
  if (!gameChannelId) {
    return { allowed: false, reason: 'GAG2 RNG Game needs a game channel. Ask a server administrator to configure one in the dashboard.' };
  }
  if (String(source.channelId || '') !== gameChannelId) {
    return { allowed: false, reason: `GAG2 RNG Game commands are only available in <#${gameChannelId}>.` };
  }
  const bypassRoles = new Set((policy.cooldownBypassRoleIds || []).map(String));
  return {
    allowed: true,
    bypassCooldown: memberRoleIds(source.member).some((roleId) => bypassRoles.has(roleId)),
  };
}

module.exports = { evaluateRngGameAccess, memberRoleIds };
