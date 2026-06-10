const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { appendTranscriptSection } = require('../src/monthlyTranscriptArchive');
const { getGuildConfig } = require('../src/serverConfig');

function attachmentToText(attachment) {
  if (!attachment?.url) return '';

  const contentType = String(attachment.contentType || '').toLowerCase();
  const fileName = String(attachment.name || attachment.filename || '').toLowerCase();
  const isGif = contentType.includes('gif') || fileName.endsWith('.gif');
  const isImage = contentType.startsWith('image/');
  const isVideo = contentType.startsWith('video/');

  if (isGif) return `GIF: ${attachment.url}`;
  if (isImage) return `Image attachment: ${attachment.url}`;
  if (isVideo) return `Video attachment: ${attachment.url}`;
  return attachment.url;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transcript-message')
    .setDescription('Save a transcript of recent messages from this channel.')
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('How many recent messages to include (1-200).')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(200),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount', true);
    const channel = interaction.channel;

    if (!channel?.isTextBased()) {
      await interaction.reply({ content: 'This command can only be used in a text channel.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const collected = [];
    let before;

    while (collected.length < amount) {
      const remaining = amount - collected.length;
      const batchSize = Math.min(100, remaining);
      const fetched = await channel.messages.fetch({ limit: batchSize, ...(before ? { before } : {}) }).catch(() => null);
      if (!fetched || fetched.size === 0) break;
      collected.push(...fetched.values());
      before = fetched.last()?.id;
      if (!before || fetched.size < batchSize) break;
    }

    if (collected.length === 0) {
      await interaction.editReply('No messages found to include in transcript.');
      return;
    }

    const sorted = collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const transcriptLines = sorted.map((message) => {
      const ts = new Date(message.createdTimestamp);
      const hh = String(ts.getHours()).padStart(2, '0');
      const mm = String(ts.getMinutes()).padStart(2, '0');
      const time = `${hh}:${mm}`;
      const attachments = [...message.attachments.values()]
        .map((attachment) => attachmentToText(attachment))
        .filter(Boolean)
        .join(' ');
      const content = `${message.content || ''} ${attachments}`.trim() || '[no content]';
      return `${time} // [${message.author.username}] - [${message.author.id}] : ${content}`;
    });

    const headerLine = `Channel: ${channel.id} - ${channel.name}`;
    const filePath = appendTranscriptSection(`message-transcript-${channel.id}`, [headerLine], transcriptLines);

    const transcriptChannelId = getGuildConfig(interaction.guildId)?.channels?.transcript;
    const transcriptChannel = transcriptChannelId ? await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null) : null;
    if (!transcriptChannel?.isTextBased()) {
      await interaction.editReply(`Transcript generated, but I could not find transcript channel (${transcriptChannelId || 'not configured'}).`);
      return;
    }

    await transcriptChannel.send({
      content: `Message transcript from #${channel.name} (${channel.id}) requested by <@${interaction.user.id}>.`,
      files: [filePath],
    });

    await interaction.editReply(`Transcript saved and sent to <#${transcriptChannelId}>.`);
  },
};
