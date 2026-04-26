const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const manager = require('../src/levelingManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-level')
    .setDescription('Set a user level manually')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to edit')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('level')
      .setDescription('Target level (min 1)')
      .setMinValue(1)
      .setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const level = interaction.options.getInteger('level', true);
    const result = manager.setUserLevel(interaction.guildId, user.id, level);

    await interaction.reply({
      content: `Updated <@${user.id}> to level **${result.level}** (Total XP: **${result.totalXp}**).`,
    });
  },
};
