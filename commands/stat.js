const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getUserStats } = require('../src/userStats');
const { CURRENCIES_BY_KEY } = require('../src/currencies');
const { getGeneratorProfile, getRateForTier } = require('../src/generator');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;

module.exports = {
  data: new SlashCommandBuilder().setName('stat').setDescription('View your Bronze Coin balance and earning rate.'),

  async execute(interaction) {
    const stats = getUserStats(interaction.user.id);
    const generator = getGeneratorProfile(interaction.user.id);
    const rate = Math.floor(getRateForTier(generator.tier) * (generator.locationMultiplier || 1));
    const coinEmoji = CURRENCIES_BY_KEY.coins.emoji;

    const content = [
      `## ${interaction.user.username}'s Balance`,
      `* ${stats.coins ?? 0} ${coinEmoji}`,
      `-# You are earning ${rate} ${coinEmoji}/m`,
    ].join('\n');

    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [{ type: 17, accent_color: 0xffffff, components: [{ type: 10, content }] }],
    });
  },
};
