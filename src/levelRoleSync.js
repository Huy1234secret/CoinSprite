const manager = require('./levelingManager');

const LEVEL_ROLE_REWARDS = new Map([
  [5, '1493906016570572801'],
  [10, '1493906102990147654'],
  [15, '1493906169054625792'],
  [20, '1493906220065619988'],
  [30, '1493906329465655376'],
  [40, '1496480275352391680'],
]);

function getEligibleRoleIds(level) {
  return [...LEVEL_ROLE_REWARDS.entries()]
    .filter(([requiredLevel]) => level >= requiredLevel)
    .map(([, roleId]) => roleId);
}

async function syncMemberLevelRoles(guild, member, forcedLevel = null) {
  const progress = Number.isFinite(forcedLevel)
    ? { level: Math.max(1, Math.floor(forcedLevel)) }
    : manager.getUserProgress(guild.id, member.id);

  const eligibleRoleIds = new Set(getEligibleRoleIds(progress.level));
  const trackedRoleIds = [...LEVEL_ROLE_REWARDS.values()];
  const toAdd = trackedRoleIds.filter((roleId) => eligibleRoleIds.has(roleId) && !member.roles.cache.has(roleId));
  const toRemove = trackedRoleIds.filter((roleId) => !eligibleRoleIds.has(roleId) && member.roles.cache.has(roleId));

  if (toAdd.length) {
    await member.roles.add(toAdd).catch(() => null);
  }

  if (toRemove.length) {
    await member.roles.remove(toRemove).catch(() => null);
  }

  return {
    level: progress.level,
    added: toAdd,
    removed: toRemove,
  };
}

module.exports = {
  LEVEL_ROLE_REWARDS,
  syncMemberLevelRoles,
};
