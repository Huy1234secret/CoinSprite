const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const manager = require('../src/levelingManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-level')
    .setDescription('Edit a user level: +N add, -N remove, sN set')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to edit')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('level')
      .setDescription('Use +N, -N, or sN (set). Example: s3')
      .setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const rawLevel = interaction.options.getString('level', true).trim().toLowerCase();
    const match = /^([+\-s])\s*(\d+)$/.exec(rawLevel);

    if (!match) {
      await interaction.reply({
        content: 'Invalid format. Use **+N** to add, **-N** to remove, or **sN** to set level (example: **s3**).',
        ephemeral: true,
      });
      return;
    }

    const operation = match[1];
    const value = Number(match[2]);
    const current = manager.getUserProgress(interaction.guildId, user.id);
    let targetLevel = current.level;

    if (operation === 's') {
      targetLevel = Math.max(1, value);
    } else if (operation === '+') {
      targetLevel = current.level + value;
    } else {
      targetLevel = Math.max(1, current.level - value);
    }

    const result = manager.setUserLevel(interaction.guildId, user.id, targetLevel);

    await interaction.reply({
      content: `Updated <@${user.id}> to level **${result.level}** (Total XP: **${result.totalXp}**).`,
    });
  },
};
