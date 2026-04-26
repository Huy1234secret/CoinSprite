const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { syncMemberLevelRoles } = require('../src/levelRoleSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync-level-roles')
    .setDescription('Sync leveling reward roles for a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Member to sync. Defaults to yourself.')
      .setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild.members.cache.get(user.id)
      || await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      await interaction.reply({
        content: 'Could not find that member in this server.',
        ephemeral: true,
      });
      return;
    }

    const result = await syncMemberLevelRoles(interaction.guild, member);
    const added = result.added.length ? result.added.map((id) => `<@&${id}>`).join(', ') : 'None';
    const removed = result.removed.length ? result.removed.map((id) => `<@&${id}>`).join(', ') : 'None';

    await interaction.reply({
      content: [
        `Synced leveling roles for <@${member.id}> at level **${result.level}**.`,
        `Added: ${added}`,
        `Removed: ${removed}`,
      ].join('\n'),
      allowedMentions: { parse: [] },
    });
  },
};
