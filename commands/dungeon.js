const { SlashCommandBuilder } = require('discord.js');
const huntCommand = require('./hunt');
const { getUserDungeonProfile } = require('../src/dungeonProfile');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dungeon')
    .setDescription('Open the dungeon menu using Discord components v2.'),

  async execute(interaction) {
    const dungeonProfile = getUserDungeonProfile(interaction.user.id);
    const content = huntCommand.buildDungeonHomeContent(interaction.user.id, dungeonProfile, 1);
    await interaction.reply(content);
  },

  async handleComponent(interaction) {
    return huntCommand.handleDungeonComponent(interaction);
  },
};
