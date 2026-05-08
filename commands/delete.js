const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const giveawayManager = require('../src/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Delete bot-managed content.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('giveaway')
        .setDescription('Delete a giveaway by giveaway message id.')
        .addStringOption((option) =>
          option
            .setName('giveaway_message_id')
            .setDescription('The main giveaway message id.')
            .setRequired(true),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const giveawayMessageId = interaction.options.getString('giveaway_message_id', true);
    await giveawayManager.handleDeleteCommand(interaction, giveawayMessageId);
  },
};
