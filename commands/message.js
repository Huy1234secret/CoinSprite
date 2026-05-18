const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { logCommandSystem } = require('../src/commandLogger');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;

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
        .setDescription('Optional message ID in the selected channel to reply to.')
        .setRequired(false)
        .setMaxLength(25),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel', true);
    const body = interaction.options.getString('message', true).trim();
    const replyToMessageId = interaction.options.getString('replyto')?.trim() ?? '';

    if (!body) {
      await interaction.reply({ content: 'Message cannot be empty.', flags: EPHEMERAL_FLAG });
      return;
    }

    if (!targetChannel?.isTextBased?.()) {
      await interaction.reply({ content: 'Please choose a text-based channel.', flags: EPHEMERAL_FLAG });
      return;
    }

    if (replyToMessageId && !/^\d{16,25}$/.test(replyToMessageId)) {
      await interaction.reply({ content: 'Reply target must be a valid message ID.', flags: EPHEMERAL_FLAG });
      return;
    }

    try {
      let sentMessage;
      if (replyToMessageId) {
        const targetMessage = await targetChannel.messages.fetch(replyToMessageId).catch(() => null);
        if (!targetMessage) {
          await interaction.reply({
            content: `I could not find message ID \`${replyToMessageId}\` in <#${targetChannel.id}>.`,
            flags: EPHEMERAL_FLAG,
          });
          return;
        }

        sentMessage = await targetMessage.reply({ content: body });
      } else {
        sentMessage = await targetChannel.send({ content: body });
      }

      await interaction.reply({
        content: `${replyToMessageId ? 'Reply' : 'Message'} sent to <#${targetChannel.id}> successfully. Sent message ID: \`${sentMessage.id}\`.`,
        flags: EPHEMERAL_FLAG,
      });
    } catch (error) {
      logCommandSystem(
        `Failed /message command by ${interaction.user.id} to ${targetChannel.id}${replyToMessageId ? ` replying to ${replyToMessageId}` : ''}: ${error?.message ?? 'unknown error'}`,
      );
      await interaction.reply({
        content: `Failed to ${replyToMessageId ? 'reply with a message' : 'send message'} in <#${targetChannel.id}>. Check my channel permissions and message content.`,
        flags: EPHEMERAL_FLAG,
      });
    }
  },
};
