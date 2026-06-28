'use strict';

const { SlashCommandBuilder } = require('discord.js');
const appealService = require('../src/appealService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Open the moderation appeal website.'),
  async execute(interaction) {
    const base = appealService.publicBaseUrl();
    if (!base) {
      await interaction.reply({ content: 'The appeal website URL is not configured.', flags: 64 });
      return;
    }
    await interaction.reply({
      content: 'Review your moderation cases and submit an appeal: ' + base + '/appeal',
      flags: 64,
    });
  },
  handleInteraction: appealService.handleInteraction,
};
