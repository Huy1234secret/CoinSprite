const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  startPvpChallenge,
  handlePvpInteraction,
  shouldLogPvpBlackjackInteraction,
} = require('../src/pvpBlackjackPlus');
const { replyIfOnCooldown, setCommandCooldown } = require('../src/commandCooldowns');

const EPHEMERAL_FLAG = MessageFlags?.Ephemeral ?? 64;
const COMMAND_COOLDOWN_MS = 120_000;

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
    if (await replyIfOnCooldown(interaction, 'pvp-blackjack', COMMAND_COOLDOWN_MS, EPHEMERAL_FLAG)) return;
    setCommandCooldown(interaction.user.id, 'pvp-blackjack', COMMAND_COOLDOWN_MS);
    await startPvpChallenge(interaction);
  },

  shouldLogInteraction: shouldLogPvpBlackjackInteraction,

  async handleInteraction(interaction) {
    return handlePvpInteraction(interaction);
  },
};
