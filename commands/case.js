const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const store = require('../src/moderationCaseStore');
const { canManageWarnings, editWarning, pardonWarning } = require('../src/warningService');
const {
  COMPONENTS_V2_FLAG,
  caseDetailContainer,
  moderationErrorContainer,
  moderationSuccessContainer,
} = require('../src/moderationComponents');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const RESPONSE_FLAGS = EPHEMERAL | COMPONENTS_V2_FLAG;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Manage moderation warning cases.')
    .addSubcommand((command) => command
      .setName('view')
      .setDescription('View a warning case.')
      .addStringOption((option) => option.setName('case_id').setDescription('Case ID such as W-000001').setRequired(true)))
    .addSubcommand((command) => command
      .setName('edit')
      .setDescription('Edit an active warning case.')
      .addStringOption((option) => option.setName('case_id').setDescription('Case ID').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Replacement reason').setMaxLength(1000))
      .addIntegerOption((option) => option.setName('points').setDescription('Replacement points').setMinValue(1).setMaxValue(10))
      .addStringOption((option) => option.setName('expires').setDescription('Expiry such as 7d, 4w, or never').setMaxLength(30))
      .addStringOption((option) => option.setName('evidence').setDescription('Replacement evidence URL').setMaxLength(1000)))
    .addSubcommand((command) => command
      .setName('pardon')
      .setDescription('Pardon a warning while preserving its audit record.')
      .addStringOption((option) => option.setName('case_id').setDescription('Case ID').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the pardon').setMaxLength(1000).setRequired(true))),

  async execute(interaction) {
    if (!canManageWarnings(interaction.member)) {
      await interaction.reply({
        ...moderationErrorContainer('Case unavailable', 'Only administrators or the configured staff role can manage cases.'),
        flags: RESPONSE_FLAGS,
      });
      return;
    }
    await interaction.deferReply({ flags: RESPONSE_FLAGS });
    const subcommand = interaction.options.getSubcommand();
    const caseId = interaction.options.getString('case_id', true);
    try {
      if (subcommand === 'view') {
        const record = store.getCase(interaction.guildId, caseId);
        if (!record) throw new Error('Warning case was not found.');
        await interaction.editReply(caseDetailContainer(record));
        return;
      }
      if (subcommand === 'pardon') {
        const result = await pardonWarning({
          guild: interaction.guild,
          caseId,
          moderatorId: interaction.user.id,
          reason: interaction.options.getString('reason', true),
        });
        await interaction.editReply(moderationSuccessContainer(
          'Case pardoned',
          '**' + result.case.id + '** was pardoned. The member now has **' + result.points + '** active point(s).',
        ));
        return;
      }
      const patch = {};
      for (const name of ['reason', 'expires', 'evidence']) {
        const value = interaction.options.getString(name);
        if (value !== null) patch[name] = value;
      }
      const points = interaction.options.getInteger('points');
      if (points !== null) patch.points = points;
      if (!Object.keys(patch).length) throw new Error('Provide at least one field to edit.');
      const result = await editWarning({
        guild: interaction.guild,
        caseId,
        moderatorId: interaction.user.id,
        patch,
      });
      await interaction.editReply(moderationSuccessContainer(
        'Case updated',
        '**' + result.case.id + '** was updated. The member now has **' + result.points + '** active point(s).',
      ));
    } catch (error) {
      await interaction.editReply(moderationErrorContainer('Case action failed', error?.message || 'Unknown error.'));
    }
  },
};
