const LEVEL_ROLE_REWARDS = new Map([
  [5, '1493906016570572801'],
  [10, '1493906102990147654'],
  [15, '1493906169054625792'],
  [20, '1493906220065619988'],
  [30, '1493906329465655376'],
  [40, '1496480275352391680'],
]);

function getEligibleRoleIds(level) {
  const numericLevel = Number(level) || 0;
  return [...LEVEL_ROLE_REWARDS.entries()]
    .filter(([requiredLevel]) => numericLevel >= requiredLevel)
    .map(([, roleId]) => roleId);
}

module.exports = {
  LEVEL_ROLE_REWARDS,
  getEligibleRoleIds,
};
