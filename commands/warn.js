const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { canManageWarnings, createWarning } = require('../src/warningService');
const {
  COMPONENTS_V2_FLAG,
  moderationErrorContainer,
  moderationSuccessContainer,
} = require('../src/moderationComponents');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const RESPONSE_FLAGS = EPHEMERAL | COMPONENTS_V2_FLAG;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a server member.')
    .addUserOption((option) => option.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the warning').setMaxLength(1000).setRequired(true))
    .addStringOption((option) => option.setName('time').setDescription('Duration such as 30m, 7d, or 4w; leave blank for permanent').setMaxLength(30).setRequired(false))
    .addAttachmentOption((option) => option.setName('attachment').setDescription('Evidence file'))
    .addBooleanOption((option) => option.setName('appealable').setDescription('Allow the user to appeal this warning')),


  async execute(interaction) {
    if (!canManageWarnings(interaction.member)) {
      await interaction.reply({
        ...moderationErrorContainer('Warning not created', 'Only administrators or the configured staff role can issue warnings.'),
        flags: RESPONSE_FLAGS,
      });
      return;
    }
    await interaction.deferReply({ flags: RESPONSE_FLAGS });
    try {
      const user = interaction.options.getUser('user', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) throw new Error('That user is not a member of this server.');
      if (user.bot) throw new Error('Bots cannot receive warning cases.');
      const result = await createWarning({
        guild: interaction.guild,
        member,
        moderatorId: interaction.user.id,
        source: 'manual',
        reason: interaction.options.getString('reason', true),
        expires: interaction.options.getString('time'),
        attachment: interaction.options.getAttachment('attachment'),
        appealable: interaction.options.getBoolean('appealable') ?? false,
        sourceChannelId: interaction.channelId,
      });
      const actions = result.enforcementEvents.length
        ? result.enforcementEvents.map((event) => event.action + (event.success ? ' ✓' : ' failed')).join(', ')
        : 'none';
      await interaction.editReply(moderationSuccessContainer('Warning created', [
        '**Case:** ' + result.case.id,
        '**Member:** <@' + user.id + '>',
        '**Active warnings:** ' + result.warnings,
        '**Notice delivery:** ' + result.delivery,
        '**Threshold actions:** ' + actions,
      ].join('\n')));
    } catch (error) {
      await interaction.editReply(moderationErrorContainer('Warning not created', error?.message || 'Unknown error.'));
    }
  },
};
