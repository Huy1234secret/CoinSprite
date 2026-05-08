const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const giveawayManager = require('../src/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-reroll')
    .setDescription('Force reroll a giveaway by skipping the active claim timer.')
    .addStringOption((option) =>
      option
        .setName('giveaway_message_id')
        .setDescription('The main giveaway message id.')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const giveawayMessageId = interaction.options.getString('giveaway_message_id', true);
    await giveawayManager.handleRerollCommand(interaction, giveawayMessageId);
  },
};
