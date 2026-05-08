const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const giveawayManager = require('../src/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('Create a giveaway setup panel.')
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Giveaway duration, for example 30m, 6h, or 1d.')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  disableActionTimeout: true,

  async init(client) {
    await giveawayManager.init(client);
  },

  async execute(interaction) {
    const duration = interaction.options.getString('duration', true);
    await giveawayManager.handleStartCommand(interaction, duration);
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
