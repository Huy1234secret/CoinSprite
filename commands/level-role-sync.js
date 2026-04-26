const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { syncMemberLevelRoles } = require('../src/levelRoleManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level-role-sync')
    .setDescription('Sync leveling reward roles for all users based on their current level.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const members = await interaction.guild.members.fetch();
    const membersToSync = Array.from(members.values()).filter((member) => !member.user.bot);

    let syncedCount = 0;
    const totalUsers = membersToSync.length;

    await interaction.editReply(`Syncing ${syncedCount} / ${totalUsers}`);

    for (const member of membersToSync) {
      await syncMemberLevelRoles(interaction.guild, member).catch(() => null);
      syncedCount += 1;
      await interaction.editReply(`Syncing ${syncedCount} / ${totalUsers}`);
    }
  },
};
