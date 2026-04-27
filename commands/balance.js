const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, getRebirthCoins } = require('../src/rngGameStore');
const { PRCOIN, RBCOIN, formatAbbreviated } = require('../src/rngGameEconomy');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Show your PRcoin balance'),
  suppressCommandLog: true,

  async execute(interaction) {
    const amount = getBalance(interaction.user.id);
    const rebirthCoins = getRebirthCoins(interaction.user.id);

    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: 0xffffff,
          components: [
            {
              type: 10,
              content: [
                `### ${interaction.user.username}'s Balance`,
                `* ${formatAbbreviated(amount)} ${PRCOIN}`,
                `* ${formatAbbreviated(rebirthCoins)} ${RBCOIN}`,
              ].join('\n'),
            },
          ],
        },
      ],
    });
  },
};
