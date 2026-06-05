const { SlashCommandBuilder } = require('discord.js');
const noiChuManager = require('../src/noiChuManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('noi-chu')
    .setDescription('Show the current noi chu game status.'),
  disableActionTimeout: true,

  async init(client) {
    await noiChuManager.init(client);
  },

  async execute(interaction) {
    await noiChuManager.handleStatus(interaction);
  },

  async handleMessageCreate(message) {
    await noiChuManager.handleMessageCreate(message);
  },
};
