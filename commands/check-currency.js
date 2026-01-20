const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getUserStats } = require('../src/userStats');
const { CURRENCIES } = require('../src/currencies');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;

function buildWalletResponse(user, stats) {
  const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
  const balanceLines = CURRENCIES.map((currency) => {
    const amount = stats[currency.key] ?? 0;
    return `## ${currency.emoji} ${amount}`;
  });
  const content = [`### ${user.username} Wallet`, ...balanceLines].join('\n');

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
  data: new SlashCommandBuilder()
    .setName('check-currency')
    .setDescription('View another user\'s wallet.')
    .addUserOption((option) =>
      option.setName('user').setDescription('User to inspect.').setRequired(true)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user', true);
    const stats = getUserStats(targetUser.id);
    await interaction.reply(buildWalletResponse(targetUser, stats));
  },
};
