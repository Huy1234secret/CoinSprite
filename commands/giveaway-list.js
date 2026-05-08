const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const giveawayManager = require('../src/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-list')
    .setDescription('List all current giveaways.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await giveawayManager.handleListCommand(interaction);
  },
};
