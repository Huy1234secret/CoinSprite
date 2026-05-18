const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { logCommandSystem } = require('../src/commandLogger');
const { fetchReplyTarget, getReferencedMessageId, parseMessageReferenceInput } = require('../src/messageReplyTarget');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send a bot message, or reply by giving a message ID/link.')
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
        .setDescription('Optional message ID or Discord message link to reply to.')
        .setRequired(false)
        .setMaxLength(200),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const targetChannel = interaction.channel;
    const body = interaction.options.getString('message', true).trim();
    const explicitReplyToMessageId = interaction.options.getString('replyto')?.trim() ?? '';

    if (!body) {
      await interaction.reply({ content: 'Message cannot be empty.', flags: EPHEMERAL_FLAG });
      return;
    }

    if (!targetChannel?.isTextBased?.()) {
      await interaction.reply({ content: 'I can only send messages in a text-based channel.', flags: EPHEMERAL_FLAG });
      return;
    }

    if (explicitReplyToMessageId && !parseMessageReferenceInput(explicitReplyToMessageId)) {
      await interaction.reply({ content: 'Reply target must be a valid message ID or Discord message link.', flags: EPHEMERAL_FLAG });
      return;
    }

    try {
      const replyTarget = await fetchReplyTarget(interaction, targetChannel, explicitReplyToMessageId);
      let sentMessage;

      if (replyTarget?.invalidChannel) {
        await interaction.reply({ content: 'I cannot reply in the channel from that message link.', flags: EPHEMERAL_FLAG });
        return;
      }

      if (replyTarget?.id && !replyTarget.message) {
        await interaction.reply({
          content: `I could not find message ID \`${replyTarget.id}\`. Use a message ID from this channel or paste the full Discord message link.`,
          flags: EPHEMERAL_FLAG,
        });
        return;
      }

      if (replyTarget?.message) {
        sentMessage = await replyTarget.message.reply({ content: body });
      } else {
        sentMessage = await targetChannel.send({ content: body });
      }

      await interaction.reply({
        content: `${replyTarget?.message ? 'Reply' : 'Message'} sent successfully. Sent message ID: \`${sentMessage.id}\`.`,
        flags: EPHEMERAL_FLAG,
      });
    } catch (error) {
      const detectedReplyId = explicitReplyToMessageId || getReferencedMessageId(interaction) || '';
      logCommandSystem(
        `Failed /message command by ${interaction.user.id} in ${targetChannel.id}${detectedReplyId ? ` replying to ${detectedReplyId}` : ''}: ${error?.message ?? 'unknown error'}`,
      );
      await interaction.reply({
        content: `Failed to ${detectedReplyId ? 'reply with a message' : 'send message'} in this channel. Check my channel permissions and message content.`,
        flags: EPHEMERAL_FLAG,
      });
    }
  },
};
