const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { logCommandSystem } = require('../src/commandLogger');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const DISCORD_MESSAGE_ID_PATTERN = /^\d{16,20}$/;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send a bot message to a selected channel.')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('The channel to send the message in.')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The message content to send.')
        .setRequired(true)
        .setMaxLength(2000),
    )
    .addStringOption((option) =>
      option
        .setName('replyto')
        .setDescription('Optional message ID in that channel to reply to.')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel', true);
    const body = interaction.options.getString('message', true).trim();
    const replyToMessageId = interaction.options.getString('replyto')?.trim() || null;

    if (!body) {
      await interaction.reply({ content: 'Message cannot be empty.', flags: EPHEMERAL_FLAG });
      return;
    }

    if (!targetChannel?.isTextBased?.()) {
      await interaction.reply({ content: 'Please choose a text-based channel.', flags: EPHEMERAL_FLAG });
      return;
    }

    if (replyToMessageId && !DISCORD_MESSAGE_ID_PATTERN.test(replyToMessageId)) {
      await interaction.reply({ content: '`replyto` must be a valid Discord message ID.', flags: EPHEMERAL_FLAG });
      return;
    }

    try {
      let sentMessage;
      if (replyToMessageId) {
        const targetMessage = await targetChannel.messages.fetch(replyToMessageId).catch(() => null);
        if (!targetMessage) {
          await interaction.reply({
            content: `Could not find message \`${replyToMessageId}\` in <#${targetChannel.id}> to reply to.`,
            flags: EPHEMERAL_FLAG,
          });
          return;
        }
        sentMessage = await targetMessage.reply({ content: body });
      } else {
        sentMessage = await targetChannel.send({ content: body });
      }

      await interaction.reply({
        content: `Message sent to <#${targetChannel.id}> successfully${replyToMessageId ? ` as a reply to \`${replyToMessageId}\`` : ''}. Sent message ID: \`${sentMessage.id}\`.`,
        flags: EPHEMERAL_FLAG,
      });
    } catch (error) {
      logCommandSystem(
        `Failed /message command by ${interaction.user.id} to ${targetChannel.id}: ${error?.message ?? 'unknown error'}`,
      );
      await interaction.reply({
        content: `Failed to send message to <#${targetChannel.id}>. Check my channel permissions and message content.`,
        flags: EPHEMERAL_FLAG,
      });
    }
  },
};
