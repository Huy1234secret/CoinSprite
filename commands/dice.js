const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, spendBalance, addBalance, recordGamblingEarnings } = require('../src/gamblingStore');
const { COIN, formatNumber } = require('../src/gamblingConfig');
const { validateBet, containerPayload } = require('../src/simpleGambling');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Guess a dice roll for a 6x payout.')
    .addIntegerOption((option) => option
      .setName('number')
      .setDescription('Pick a number from 1 to 6.')
      .setMinValue(1)
      .setMaxValue(6)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('bet')
      .setDescription('Bet amount, max 10k.')
      .setRequired(true)),
  suppressCommandLog: true,

  async execute(interaction) {
    const guess = interaction.options.getInteger('number', true);
    const validation = validateBet(interaction.options.getString('bet', true), getBalance(interaction.user.id));
    if (!validation.ok) {
      await interaction.reply({ content: validation.message, flags: EPHEMERAL_FLAG });
      return;
    }
    if (!spendBalance(interaction.user.id, validation.amount)) {
      await interaction.reply({ content: 'Your balance changed before the bet could be placed.', flags: EPHEMERAL_FLAG });
      return;
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    const won = roll === guess;
    const payout = won ? validation.amount * 6 : 0;
    if (payout > 0) {
      addBalance(interaction.user.id, payout);
      recordGamblingEarnings(interaction.user.id, payout);
    }

    await interaction.reply(containerPayload([
      `### Dice ${won ? 'Win' : 'Loss'}`,
      `* ${interaction.user} picked **${guess}** and rolled **${roll}**.`,
      `-# Bet: ${formatNumber(validation.amount)} ${COIN}`,
      `-# ${won ? `Payout: ${formatNumber(payout)} ${COIN}` : 'No payout this round.'}`,
    ].join('\n')));
  },
};
