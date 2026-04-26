const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const manager = require('../src/levelingManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-xp')
    .setDescription('Add XP to a user manually')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to edit')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('How much XP to add')
      .setMinValue(1)
      .setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const result = manager.addUserXp(interaction.guildId, user.id, amount);

    await interaction.reply({
      content: `Added **${result.addedXp} XP** to <@${user.id}>. New level: **${result.newLevel}** (Total XP: **${result.totalXp}**).`,
    });
  },
};
