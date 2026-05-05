const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, getJackpotBalance } = require('../src/gamblingStore');
const { PRCOIN, JPCOIN, formatAbbreviated, formatNumber } = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Show your PRcoin and JPcoin balance'),
  suppressCommandLog: true,

  async execute(interaction) {
    const prcoin = getBalance(interaction.user.id);
    const jpcoin = getJackpotBalance(interaction.user.id);

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
                `* ${formatNumber(jpcoin)} ${JPCOIN}`,
              ].join('\n'),
            },
          ],
        },
      ],
    });
  },
};
