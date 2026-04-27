const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, getRebirthBalance } = require('../src/rngGameStore');
const { PRCOIN, RBCOIN, formatAbbreviated, formatNumber } = require('../src/rngConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Show your PRcoin and Rebirth Coin balance'),
  suppressCommandLog: true,

  async execute(interaction) {
    const prcoin = getBalance(interaction.user.id);
    const rbcoin = getRebirthBalance(interaction.user.id);

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
                `* ${formatAbbreviated(prcoin)} ${PRCOIN}`,
                `* ${formatNumber(rbcoin)} ${RBCOIN}`,
              ].join('\n'),
            },
          ],
        },
      ],
    });
  },
};
