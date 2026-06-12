const { SlashCommandBuilder } = require('discord.js');
const wordChainManager = require('../src/wordChainManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('word-chain')
    .setDescription('Show the current Word Chain game status.'),
  registerSlashCommand: false,
  disableActionTimeout: true,

  async init(client) {
    await wordChainManager.init(client);
  },

  async execute(interaction) {
    await wordChainManager.handleStatus(interaction);
  },

  async handleMessageCreate(message) {
    await wordChainManager.handleMessageCreate(message);
  },
};
