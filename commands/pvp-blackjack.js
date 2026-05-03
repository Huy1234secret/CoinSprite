require('../src/blackjackCanvasStyle');

const { SlashCommandBuilder } = require('discord.js');
const {
  startPvpChallenge,
  handlePvpBlackjackInteraction,
  shouldLogBlackjackInteraction,
} = require('../src/blackjackCore');

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
      .setDescription('PRcoin bet amount, like 1000, 5k, or all')
      .setRequired(true)),
  suppressCommandLog: true,

  async execute(interaction) {
    await startPvpChallenge(interaction);
  },

  shouldLogInteraction: shouldLogBlackjackInteraction,

  async handleInteraction(interaction) {
    return handlePvpBlackjackInteraction(interaction);
  },
};
