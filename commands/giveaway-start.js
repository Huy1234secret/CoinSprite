const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const giveawayManager = require('../src/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('Create a giveaway setup panel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  disableActionTimeout: true,

  async init(client) {
    await giveawayManager.init(client);
  },

  async execute(interaction) {
    await giveawayManager.handleStartCommand(interaction);
  },

  async handleInteraction(interaction) {
    return giveawayManager.handleInteraction(interaction);
  },

  async handleMessageCreate(message) {
    await giveawayManager.handleMessageCreate(message);
  },

  async handleMessageDelete(message) {
    await giveawayManager.handleMessageDelete(message);
  },
};
