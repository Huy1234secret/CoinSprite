const { SlashCommandBuilder } = require('discord.js');
const {
  startBlackjack,
  handleBlackjackInteraction,
  shouldLogBlackjackInteraction,
} = require('../src/blackjackCore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play Blackjack against the dealer with PRcoin')
    .addStringOption((option) => option
      .setName('amount')
      .setDescription('Bet amount, like 1000, 5k, or all')
      .setRequired(true)),
  suppressCommandLog: true,

  async execute(interaction) {
    await startBlackjack(interaction);
  },

  shouldLogInteraction: shouldLogBlackjackInteraction,

  async handleInteraction(interaction) {
    return handleBlackjackInteraction(interaction);
  },
};
