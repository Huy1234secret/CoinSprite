const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const manager = require('../src/levelingManager');
const { LEVEL_ROLE_REWARDS, getEligibleRoleIds } = require('../src/levelRoleRewards');

async function syncMemberLevelRoles(guild, member) {
  const progress = manager.getUserProgress(guild.id, member.id);
  const desiredRoleIds = new Set(getEligibleRoleIds(progress.level));
  const trackedRoleIds = [...LEVEL_ROLE_REWARDS.values()];

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
  data: new SlashCommandBuilder()
    .setName('level-role-sync')
    .setDescription('Sync leveling reward roles for a user based on their current level.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to sync (defaults to yourself)')
      .setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild.members.cache.get(targetUser.id)
      || await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      await interaction.reply({
        content: 'Could not find that member in this server.',
        ephemeral: true,
      });
      return;
    }

    const result = await syncMemberLevelRoles(interaction.guild, member);

    await interaction.reply({
      content:
        `Synced leveling roles for <@${member.id}> (level **${result.level}**). `
        + `Added **${result.added}**, removed **${result.removed}**, expected total reward roles: **${result.desiredRoleCount}**.`,
      ephemeral: true,
    });
  },
};
