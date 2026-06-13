const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const giveawayManager = require('../src/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('Create a giveaway setup panel.')
    .addRoleOption((option) =>
      option
        .setName('ping_role')
        .setDescription('Role to ping once when the giveaway starts.')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  disableActionTimeout: true,

  async init(client) {
    await giveawayManager.init(client);
  },

  async execute(interaction) {
    const pingRole = interaction.options.getRole('ping_role', false);
    await giveawayManager.handleStartCommand(interaction, pingRole?.id || '');
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
