const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { resetAllRngData } = require('../src/rngGameStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rng-wipe')
    .setDescription('Wipe all RNG game data (balances + upgrades).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option
      .setName('confirm')
      .setDescription('Type WIPE to confirm')
      .setRequired(true)),

  async execute(interaction) {
    const confirmation = interaction.options.getString('confirm', true).trim().toUpperCase();
    if (confirmation !== 'WIPE') {
      await interaction.reply({
        flags: COMPONENTS_V2_FLAG,
        components: [
          {
            type: 17,
            accent_color: 0xED4245,
            components: [
              { type: 10, content: '### RNG wipe cancelled\n-# Confirmation text must be exactly `WIPE`.' },
            ],
          },
        ],
      });
      return;
    }

    resetAllRngData();
    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: 0xFEE75C,
          components: [
            { type: 10, content: `### RNG game data wiped by ${interaction.user.username}\n-# All balances and upgrades were reset.` },
          ],
        },
      ],
    });
  },
};
