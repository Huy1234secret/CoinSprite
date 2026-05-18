const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { logCommandSystem } = require('../src/commandLogger');
const { fetchReplyTarget, parseMessageReferenceInput } = require('../src/messageReplyTarget');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Make the bot reply to a message by ID or Discord message link.')
    .addStringOption((option) =>
      option
        .setName('message_id')
        .setDescription('Message ID or Discord message link to reply to.')
        .setRequired(true)
        .setMaxLength(200),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The reply content to send.')
        .setRequired(true)
        .setMaxLength(2000),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const targetChannel = interaction.channel;
    const replyTo = interaction.options.getString('message_id', true).trim();
    const body = interaction.options.getString('message', true).trim();

    if (!body) {
      await interaction.reply({ content: 'Message cannot be empty.', flags: EPHEMERAL_FLAG });
      return;
    }

    if (!targetChannel?.isTextBased?.()) {
      await interaction.reply({ content: 'I can only reply from a text-based channel.', flags: EPHEMERAL_FLAG });
      return;
    }

    if (!parseMessageReferenceInput(replyTo)) {
      await interaction.reply({ content: 'Reply target must be a valid message ID or Discord message link.', flags: EPHEMERAL_FLAG });
      return;
    }

    try {
      const replyTarget = await fetchReplyTarget(interaction, targetChannel, replyTo);

      if (replyTarget?.invalidChannel) {
        await interaction.reply({ content: 'I cannot reply in the channel from that message link.', flags: EPHEMERAL_FLAG });
        return;
      }

      if (!replyTarget?.message) {
        await interaction.reply({
          content: `I could not find message ID \`${replyTarget?.id ?? replyTo}\`. Use a message ID from this channel or paste the full Discord message link.`,
          flags: EPHEMERAL_FLAG,
        });
        return;
      }

      const sentMessage = await replyTarget.message.reply({ content: body });
      await interaction.reply({
        content: `Reply sent successfully. Sent message ID: \`${sentMessage.id}\`.`,
        flags: EPHEMERAL_FLAG,
      });
    } catch (error) {
      logCommandSystem(
        `Failed /reply command by ${interaction.user.id} to ${replyTo}: ${error?.message ?? 'unknown error'}`,
      );
      await interaction.reply({
        content: 'Failed to reply to that message. Check my channel permissions and message content.',
        flags: EPHEMERAL_FLAG,
      });
    }
  },
};
