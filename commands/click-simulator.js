const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const { clickSimulatorUrl, publicWebBaseUrl } = require('../src/clickSimulator/token');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('click-simulator')
    .setDescription('Open the Click Simulator web game.'),

  async execute(interaction) {
    const baseUrl = publicWebBaseUrl();
    if (!baseUrl) {
      await interaction.reply({
        content: 'Click Simulator needs `PUBLIC_WEB_BASE_URL` or `DISCORD_REDIRECT_URI` before I can make a game link.',
        flags: EPHEMERAL,
      });
      return;
    }

    const url = clickSimulatorUrl({
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Open Click Simulator')
        .setStyle(ButtonStyle.Link)
        .setURL(url),
    );

    await interaction.reply({
      content: [
        '## Click Simulator',
        'Click anywhere on the page to earn clicks.',
        'Critical click: **0.1%** chance for **10x** clicks.',
      ].join('\n'),
      components: [row],
      flags: EPHEMERAL,
    });
  },
};
