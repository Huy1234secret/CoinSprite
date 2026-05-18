const {
  ActionRowBuilder,
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { logCommandSystem } = require('../src/commandLogger');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const MESSAGE_REPLY_COMMAND_NAME = 'Reply with Bot Message';
const MESSAGE_REPLY_MODAL_PREFIX = 'message-reply:';
const MESSAGE_REPLY_AWAITED_MODAL_PREFIX = 'message-reply-submit:';
const MESSAGE_REPLY_BODY_INPUT = 'message_reply_body';
const MODAL_SUBMIT_TIMEOUT_MS = 5 * 60 * 1000;

function getReplyModal(customId) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Reply with bot message')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(MESSAGE_REPLY_BODY_INPUT)
          .setLabel('Message content')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000),
      ),
    );
}

async function sendReplyFromModalSubmit(modalInteraction, targetMessage) {
  const body = modalInteraction.fields.getTextInputValue(MESSAGE_REPLY_BODY_INPUT).trim();

  if (!body) {
    await modalInteraction.reply({ content: 'Message cannot be empty.', flags: EPHEMERAL_FLAG });
    return true;
  }

  if (!targetMessage?.reply) {
    await modalInteraction.reply({ content: 'I cannot reply to that message.', flags: EPHEMERAL_FLAG });
    return true;
  }

  try {
    await targetMessage.reply({ content: body });
    await modalInteraction.reply({
      content: 'Reply sent successfully.',
      flags: EPHEMERAL_FLAG,
    });
  } catch (error) {
    logCommandSystem(
      `Failed bot message reply command by ${modalInteraction.user.id}: ${error?.message ?? 'unknown error'}`,
    );
    await modalInteraction.reply({
      content: 'Failed to reply to that message. Check my channel permissions and message content.',
      flags: EPHEMERAL_FLAG,
    });
  }

  return true;
}

async function handleMessageContextMenu(interaction) {
  if (!interaction.isMessageContextMenuCommand?.()) return false;
  if (interaction.commandName !== MESSAGE_REPLY_COMMAND_NAME) return false;

  if (!interaction.targetMessage?.reply) {
    await interaction.reply({ content: 'I cannot reply to that message.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const modalCustomId = `${MESSAGE_REPLY_AWAITED_MODAL_PREFIX}${interaction.id}`;
  const targetMessage = interaction.targetMessage;

  await interaction.showModal(getReplyModal(modalCustomId));

  interaction.awaitModalSubmit({
    filter: (modalInteraction) =>
      modalInteraction.customId === modalCustomId && modalInteraction.user.id === interaction.user.id,
    time: MODAL_SUBMIT_TIMEOUT_MS,
  })
    .then((modalInteraction) => sendReplyFromModalSubmit(modalInteraction, targetMessage))
    .catch(() => null);

  return true;
}

async function handleReplyModal(interaction) {
  if (!interaction.isModalSubmit?.()) return false;
  if (!interaction.customId?.startsWith(MESSAGE_REPLY_MODAL_PREFIX)) return false;

  const messageId = interaction.customId.slice(MESSAGE_REPLY_MODAL_PREFIX.length);
  const body = interaction.fields.getTextInputValue(MESSAGE_REPLY_BODY_INPUT).trim();

  if (!body) {
    await interaction.reply({ content: 'Message cannot be empty.', flags: EPHEMERAL_FLAG });
    return true;
  }

  if (!interaction.channel?.isTextBased?.()) {
    await interaction.reply({ content: 'I cannot reply in this channel.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const targetMessage = await interaction.channel.messages.fetch(messageId).catch(() => null);
  if (!targetMessage) {
    await interaction.reply({ content: 'I could not find the message to reply to.', flags: EPHEMERAL_FLAG });
    return true;
  }

  try {
    await targetMessage.reply({ content: body });
    await interaction.reply({
      content: 'Reply sent successfully.',
      flags: EPHEMERAL_FLAG,
    });
  } catch (error) {
    logCommandSystem(
      `Failed bot message reply command by ${interaction.user.id} to ${messageId}: ${error?.message ?? 'unknown error'}`,
    );
    await interaction.reply({
      content: 'Failed to reply to that message. Check my channel permissions and message content.',
      flags: EPHEMERAL_FLAG,
    });
  }

  return true;
}

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName(MESSAGE_REPLY_COMMAND_NAME)
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    return handleMessageContextMenu(interaction);
  },

  async handleInteraction(interaction) {
    if (await handleMessageContextMenu(interaction)) return true;
    return handleReplyModal(interaction);
  },
};
