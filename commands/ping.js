const { SlashCommandBuilder } = require('discord.js');

function buildPingLine(latencyMs, apiPingMs) {
  const safeLatency = Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : 0;
  const safeApiPing = Number.isFinite(apiPingMs) ? Math.max(0, Math.round(apiPingMs)) : 0;
  return `🏓 Pong! Bot latency: **${safeLatency}ms** | API ping: **${safeApiPing}ms**`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot ping in milliseconds.'),

  async execute(interaction, client) {
    await interaction.deferReply();
    const latencyMs = Date.now() - interaction.createdTimestamp;
    const apiPingMs = client?.ws?.ping;
    await interaction.editReply(buildPingLine(latencyMs, apiPingMs));
  },

  async handleMessageCreate(message, client) {
    if (!message.guild || message.author.bot) {
      return;
    }

    const content = message.content.trim().toLowerCase();
    if (content !== '!ping') {
      return;
    }

    const latencyMs = Date.now() - message.createdTimestamp;
    const apiPingMs = client?.ws?.ping;
    await message.reply(buildPingLine(latencyMs, apiPingMs));
  },
};
