const manager = require('./levelingManager');
const { getEligibleRoleIds, getLevelRoleRewards } = require('./levelRoleRewards');

async function syncMemberLevelRoles(guild, member) {
  const progress = manager.getUserProgress(guild.id, member.id);
  const desiredRoleIds = new Set(getEligibleRoleIds(progress.level, guild.id));
  const trackedRoleIds = [...getLevelRoleRewards(guild.id).values()];

  const toAdd = trackedRoleIds.filter((roleId) => desiredRoleIds.has(roleId) && !member.roles.cache.has(roleId));
  const toRemove = trackedRoleIds.filter((roleId) => !desiredRoleIds.has(roleId) && member.roles.cache.has(roleId));

  if (toAdd.length > 0) {
    await member.roles.add(toAdd).catch(() => null);
  }

  if (toRemove.length > 0) {
    await member.roles.remove(toRemove).catch(() => null);
  }

  return {
    level: progress.level,
    added: toAdd.length,
    removed: toRemove.length,
    desiredRoleCount: desiredRoleIds.size,
  };
}

module.exports = {
  syncMemberLevelRoles,
};
