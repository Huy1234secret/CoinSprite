const { SlashCommandBuilder } = require('discord.js');
const {
  startPvpChallenge,
  handlePvpInteraction,
  shouldLogPvpBlackjackInteraction,
} = require('../src/pvpBlackjackPlus');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvp-blackjack')
    .setDescription('Challenge another player to hidden-card PVP Blackjack')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The player you want to challenge')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('amount')
      .setDescription('PRcoin bet amount, max 100k')
      .setRequired(true)),
  suppressCommandLog: true,

  async execute(interaction) {
    await startPvpChallenge(interaction);
  },

  shouldLogInteraction: shouldLogPvpBlackjackInteraction,

  async handleInteraction(interaction) {
    return handlePvpInteraction(interaction);
  },
};
