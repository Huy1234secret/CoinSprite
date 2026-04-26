const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { syncMemberLevelRoles } = require('../src/levelRoleManager');

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
