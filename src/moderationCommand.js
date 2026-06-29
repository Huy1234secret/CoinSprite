'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { canManageWarnings } = require('./warningService');
const { executeSanction, formatDuration, initSanctionService } = require('./moderationActionService');
const {
  COMPONENTS_V2_FLAG,
  moderationErrorContainer,
  moderationSuccessContainer,
} = require('./moderationComponents');

const RESPONSE_FLAGS = (MessageFlags.Ephemeral ?? 64) | COMPONENTS_V2_FLAG;
const LABELS = {
  mute: { verb: 'muted', description: 'Timeout a server member and create a moderation case.' },
  kick: { verb: 'kicked', description: 'Kick a server member and create a moderation case.' },
  ban: { verb: 'banned', description: 'Ban a user and create a moderation case.' },
};

function buildData(action) {
  const labels = LABELS[action];
  const builder = new SlashCommandBuilder()
    .setName(action)
    .setDescription(labels.description)
    .addUserOption((option) => option.setName('user').setDescription('User to ' + action).setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for this action').setMaxLength(1000).setRequired(true));
  if (action !== 'kick') {
    builder.addStringOption((option) => option
      .setName('time')
      .setDescription(action === 'ban' ? 'Duration such as 7d or 4w; leave blank for permanent' : 'Duration such as 30m or 7d; leave blank for permanent')
      .setMaxLength(30)
      .setRequired(false));
  }
  return builder
    .addAttachmentOption((option) => option.setName('attachment').setDescription('Evidence file saved with the case'))
    .addBooleanOption((option) => option.setName('appealable').setDescription('Whether the user may appeal this action'));
}

function buildModerationCommand(action) {
  const labels = LABELS[action];
  if (!labels) throw new Error('Unsupported moderation command: ' + action);
  return {
    data: buildData(action),

    init(client) {
      initSanctionService(client);
    },

    async execute(interaction) {
      if (!canManageWarnings(interaction.member)) {
        await interaction.reply({
          ...moderationErrorContainer('Action denied', 'Only administrators or the configured staff role can use moderation commands.'),
          flags: RESPONSE_FLAGS,
        });
        return;
      }
      await interaction.deferReply({ flags: RESPONSE_FLAGS });
      try {
        const user = interaction.options.getUser('user', true);
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        const result = await executeSanction({
          action,
          guild: interaction.guild,
          user,
          member,
          moderatorId: interaction.user.id,
          reason: interaction.options.getString('reason', true),
          time: action === 'kick' ? '' : interaction.options.getString('time'),
          attachment: interaction.options.getAttachment('attachment'),
          appealable: interaction.options.getBoolean('appealable') ?? true,
          sourceChannelId: interaction.channelId,
        });
        const details = [
          '**Case:** ' + result.case.id,
          '**User:** <@' + user.id + '>',
          '**Action:** ' + labels.verb,
          '**Reason:** ' + result.case.reason,
          '**Appealable:** ' + (result.case.appealable ? 'Yes' : 'No'),
          '**Notice delivery:** ' + result.delivery,
        ];
        if (action !== 'kick') details.splice(4, 0, '**Duration:** ' + formatDuration(result.durationMs));
        if (result.case.attachments?.length) details.push('**Evidence:** saved to the case');
        await interaction.editReply(moderationSuccessContainer('User ' + labels.verb, details.join('\n')));
      } catch (error) {
        await interaction.editReply(moderationErrorContainer('Action failed', error?.message || 'Unknown error.'));
      }
    },
  };
}

module.exports = { buildModerationCommand };
