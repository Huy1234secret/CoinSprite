const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, getJackpotBalance } = require('../src/gamblingStore');
const { PRCOIN, JBCOIN, formatAbbreviated, formatNumber } = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Show your PRcoin and Jbcoin balance'),
  suppressCommandLog: true,

  async execute(interaction) {
    const prcoin = getBalance(interaction.user.id);
    const jbcoin = getJackpotBalance(interaction.user.id);

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
                `* ${formatNumber(jbcoin)} ${JBCOIN}`,
              ].join('\n'),
            },
          ],
        },
      ],
    });
  },
};
