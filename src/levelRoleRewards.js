const { DEFAULT_GUILD_CONFIG, getGuildConfig } = require('./serverConfig');

function toRewardMap(config) {
  return new Map(
    (config?.xp?.levelRoleRewards || [])
      .map((reward) => [Math.max(0, Math.floor(Number(reward.level) || 0)), String(reward.roleId || '')])
      .filter(([level, roleId]) => level > 0 && roleId),
  );
}

const LEVEL_ROLE_REWARDS = toRewardMap(DEFAULT_GUILD_CONFIG);

function getLevelRoleRewards(guildId) {
  return toRewardMap(getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG);
}

function getEligibleRoleIds(level, guildId) {
  const numericLevel = Number(level) || 0;
  return [...getLevelRoleRewards(guildId).entries()]
    .filter(([requiredLevel]) => numericLevel >= requiredLevel)
    .map(([, roleId]) => roleId);
}

module.exports = {
  LEVEL_ROLE_REWARDS,
  getEligibleRoleIds,
  getLevelRoleRewards,
};
