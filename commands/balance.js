const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, getSkillPoints } = require('../src/gamblingStore');
const { COIN, SKILL_POINT, formatAbbreviated, formatNumber } = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('Show your coin and skill point balance'),
  suppressCommandLog: true,

  async execute(interaction) {
    const coins = getBalance(interaction.user.id);
    const skillPoints = getSkillPoints(interaction.user.id);

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
                `* ${formatNumber(skillPoints)} ${SKILL_POINT}`,
              ].join('\n'),
            },
          ],
        },
      ],
    });
  },
};
