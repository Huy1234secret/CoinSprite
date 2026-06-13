const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const rerollGiveaway = require('../src/giveawayRerollCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reroll-giveaway')
    .setDescription('Reroll an ended giveaway or an active claim round.')
    .addStringOption((option) =>
      option
        .setName('giveaway_message_id')
        .setDescription('The main giveaway message id or link.')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const giveawayMessageId = interaction.options.getString('giveaway_message_id', true);
    await rerollGiveaway.execute(interaction, giveawayMessageId);
  },
};
