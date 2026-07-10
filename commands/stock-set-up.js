const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

function dashboardBaseUrl() {
  const configured = String(process.env.PUBLIC_WEB_BASE_URL || '').trim().replace(/\/+$/g, '');
  if (configured) return configured;
  try {
    const redirect = new URL(process.env.DISCORD_REDIRECT_URI || '');
    return redirect.origin;
  } catch {
    return '';
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stock-set-up')
    .setDescription('Set up GAG2 stock auto-posting in the dashboard.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const baseUrl = dashboardBaseUrl();
    const dashboardText = baseUrl ? `${baseUrl}/admin` : 'the admin dashboard';
    await interaction.reply({
      content: [
        'Open the dashboard and edit the **Gag2 stock** tab.',
        `Dashboard: ${dashboardText}`,
        `Server ID: ${interaction.guildId}`,
      ].join('\n'),
      flags: EPHEMERAL,
    });
  },
};
