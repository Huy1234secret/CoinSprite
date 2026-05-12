require('../src/blackjackCanvasStyle');

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  startBlackjack,
  handleBlackjackInteraction,
  shouldLogBlackjackInteraction,
} = require('../src/blackjackCore');
const { replyIfOnCooldown, setCommandCooldown } = require('../src/commandCooldowns');

const EPHEMERAL_FLAG = MessageFlags?.Ephemeral ?? 64;
const COMMAND_COOLDOWN_MS = 30_000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play Blackjack against the dealer with PRcoin')
    .addStringOption((option) => option
      .setName('amount')
      .setDescription('Enter your PRcoin bet amount')
      .setRequired(true)),
  suppressCommandLog: true,

  async execute(interaction) {
    if (await replyIfOnCooldown(interaction, 'blackjack', COMMAND_COOLDOWN_MS, EPHEMERAL_FLAG)) return;
    await startBlackjack(interaction);
    if (interaction.replied && !interaction.ephemeral) {
      setCommandCooldown(interaction.user.id, 'blackjack', COMMAND_COOLDOWN_MS);
    }
  },

  shouldLogInteraction: shouldLogBlackjackInteraction,

  async handleInteraction(interaction) {
    return handleBlackjackInteraction(interaction);
  },
};
