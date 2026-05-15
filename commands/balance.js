const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance } = require('../src/gamblingStore');
const { COIN, formatAbbreviated } = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Show your coin balance'),
  suppressCommandLog: true,

  async execute(interaction) {
    const coins = getBalance(interaction.user.id);
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
                `* ${formatAbbreviated(coins)} ${COIN}`,
              ].join('\n'),
            },
          ],
        },
      ],
    });
  },
};
