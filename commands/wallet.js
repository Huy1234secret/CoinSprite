const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getUserStats } = require('../src/userStats');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const COIN_EMOJI = '<:CRCoin:1447459216574124074>';
const DIAMOND_EMOJI = '<:CRDiamond:1449260848705962005>';
const PRISMATIC_EMOJI = '<:CRPrismatic:1449260850945982606>';

function buildWalletResponse(user, stats) {
  const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
  const content = `### ${user.username} Wallet\n## ${COIN_EMOJI} ${stats.coins}\n## ${DIAMOND_EMOJI} ${stats.diamonds}\n## ${PRISMATIC_EMOJI} ${stats.prismatic}`;

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 9,
            components: [{ type: 10, content }],
            accessory: {
              type: 11,
              media: { url: avatarUrl },
              description: `${user.username} avatar`,
            },
          },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder().setName('wallet').setDescription('Check your wallet.'),

  async execute(interaction) {
    const stats = getUserStats(interaction.user.id);
    await interaction.reply(buildWalletResponse(interaction.user, stats));
  },
};
