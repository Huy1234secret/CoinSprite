const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, spendBalance, addBalance, recordGamblingEarnings } = require('../src/gamblingStore');
const { COIN, formatNumber } = require('../src/gamblingConfig');
const { validateBet, containerPayload } = require('../src/simpleGambling');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coin-flip')
    .setDescription('Pick heads or tails for a 2x payout.')
    .addStringOption((option) => option
      .setName('side')
      .setDescription('Choose heads or tails.')
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })
      .setRequired(true))
    .addStringOption((option) => option
      .setName('bet')
      .setDescription('Bet amount, max 10k.')
      .setRequired(true)),
  suppressCommandLog: true,

  async execute(interaction) {
    const side = interaction.options.getString('side', true);
    const validation = validateBet(interaction.options.getString('bet', true), getBalance(interaction.user.id));
    if (!validation.ok) {
      await interaction.reply({ content: validation.message, flags: EPHEMERAL_FLAG });
      return;
    }
    if (!spendBalance(interaction.user.id, validation.amount)) {
      await interaction.reply({ content: 'Your balance changed before the bet could be placed.', flags: EPHEMERAL_FLAG });
      return;
    }

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === side;
    const payout = won ? validation.amount * 2 : 0;
    if (payout > 0) {
      addBalance(interaction.user.id, payout);
      recordGamblingEarnings(interaction.user.id, payout);
    }

    await interaction.reply(containerPayload([
      `### Coin Flip ${won ? 'Win' : 'Loss'}`,
      `* ${interaction.user} picked **${side}**. The coin landed on **${result}**.`,
      `-# Bet: ${formatNumber(validation.amount)} ${COIN}`,
      `-# ${won ? `Payout: ${formatNumber(payout)} ${COIN}` : 'No payout this round.'}`,
    ].join('\n')));
  },
};
