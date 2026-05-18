const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { logCommandSystem } = require('../src/commandLogger');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const MESSAGE_ID_PATTERN = /^\d{16,25}$/;

function getReferencedMessageId(interaction) {
  const directReference = interaction.reference?.messageId
    ?? interaction.messageReference?.messageId
    ?? interaction.message?.reference?.messageId
    ?? interaction.message?.messageReference?.messageId
    ?? interaction.data?.message_reference?.message_id
    ?? interaction.raw?.message_reference?.message_id
    ?? null;

  if (directReference) return directReference;

  const targetMessageId = interaction.targetMessage?.id ?? interaction.targetId ?? null;
  if (targetMessageId) return targetMessageId;

  return null;
}

async function fetchReplyTarget(interaction, targetChannel, explicitReplyToMessageId) {
  const detectedMessageId = getReferencedMessageId(interaction);
  const replyToMessageId = explicitReplyToMessageId || detectedMessageId;
  if (!replyToMessageId) return null;

  const targetMessage = await targetChannel.messages.fetch(replyToMessageId).catch(() => null);
  if (!targetMessage) return { id: replyToMessageId, message: null };

  return { id: replyToMessageId, message: targetMessage };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send a bot message in this channel, or reply when the command is used as a reply.')
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
        .setDescription('Optional fallback message ID in this channel to reply to.')
        .setRequired(false)
        .setMaxLength(25),
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

    if (explicitReplyToMessageId && !MESSAGE_ID_PATTERN.test(explicitReplyToMessageId)) {
      await interaction.reply({ content: 'Reply target must be a valid message ID.', flags: EPHEMERAL_FLAG });
      return;
    }

    try {
      const replyTarget = await fetchReplyTarget(interaction, targetChannel, explicitReplyToMessageId);
      let sentMessage;

      if (replyTarget?.id && !replyTarget.message) {
        await interaction.reply({
          content: `I could not find message ID \`${replyTarget.id}\` in this channel.`,
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
        content: `${replyTarget?.message ? 'Reply' : 'Message'} sent in this channel successfully. Sent message ID: \`${sentMessage.id}\`.`,
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
