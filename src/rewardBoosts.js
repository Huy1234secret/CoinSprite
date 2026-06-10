const { DEFAULT_GUILD_CONFIG, getGuildConfig } = require('./serverConfig');

const ROLE_BOOSTS = DEFAULT_GUILD_CONFIG.xp.boosts;

function getRoleBoosts(guildId) {
  return (getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG).xp.boosts || [];
}

function getMemberRoleBoosts(member) {
  const roles = member?.roles?.cache;
  if (!roles) return [];
  return getRoleBoosts(member.guild?.id).filter((boost) => roles.has(boost.roleId));
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
  getRoleBoosts,
  getMemberRoleBoosts,
  getXpBoostPercent,
  formatBoostLines,
};
