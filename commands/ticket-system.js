const { SlashCommandBuilder } = require('discord.js');
const ticketSystem = require('../src/ticketSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Force refresh the support ticket panel message.'),

  async init(client) {
    await ticketSystem.init(client);
  },

  async execute(interaction) {
    await ticketSystem.forceRefreshPanel(interaction);
  },

  async handleInteraction(interaction) {
    return ticketSystem.handleInteraction(interaction);
  },

  async handleMessageDelete(message) {
    return ticketSystem.handleMessageDelete(message);
  },
};
