const ROLE_BOOSTS = [
  { roleId: '1502905486645788713', xpPercent: 10 },
  { roleId: '1502905217945964596', xpPercent: 5 },
  { roleId: '1493911895634084042', xpPercent: 25 },
];

function getMemberRoleBoosts(member) {
  const roles = member?.roles?.cache;
  if (!roles) return [];
  return ROLE_BOOSTS.filter((boost) => roles.has(boost.roleId));
}

function sumBoostPercent(boosts, key) {
  return boosts.reduce((total, boost) => total + Math.max(0, Number(boost[key]) || 0), 0);
}

function getXpBoostPercent(member) {
  return sumBoostPercent(getMemberRoleBoosts(member), 'xpPercent');
}

function formatBoostLines(boosts, key) {
  return boosts
    .filter((boost) => Math.max(0, Number(boost[key]) || 0) > 0)
    .map((boost) => `-# +${boost[key]}% - <@&${boost.roleId}>`);
}

module.exports = {
  ROLE_BOOSTS,
  getMemberRoleBoosts,
  getXpBoostPercent,
  formatBoostLines,
};
