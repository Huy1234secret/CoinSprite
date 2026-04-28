const { SlashCommandBuilder } = require('discord.js');
const { buildAchievementsMessage } = require('../src/achievements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('View your CoinSprite achievements'),

  async execute(interaction) {
    await interaction.reply(buildAchievementsMessage(interaction.user.username, interaction.user.id));
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('achievements:switch:')) {
      return false;
    }

    await interaction.reply({
      content: 'More achievement pages are coming soon.',
      flags: 64,
    }).catch(() => null);
    return true;
  },
};
