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
const MESSAGE_REPLY_BODY_INPUT = 'message_reply_body';

function getReplyModal(messageId) {
  return new ModalBuilder()
    .setCustomId(`${MESSAGE_REPLY_MODAL_PREFIX}${messageId}`)
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

async function handleMessageContextMenu(interaction) {
  if (!interaction.isMessageContextMenuCommand?.()) return false;
  if (interaction.commandName !== MESSAGE_REPLY_COMMAND_NAME) return false;

  if (!interaction.targetMessage?.reply) {
    await interaction.reply({ content: 'I cannot reply to that message.', flags: EPHEMERAL_FLAG });
    return true;
  }

  await interaction.showModal(getReplyModal(interaction.targetMessage.id));
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
    const sentMessage = await targetMessage.reply({ content: body });
    await interaction.reply({
      content: `Reply sent successfully. Sent message ID: \`${sentMessage.id}\`.`,
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
