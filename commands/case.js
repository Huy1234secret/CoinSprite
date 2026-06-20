const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const store = require('../src/moderationCaseStore');
const { canManageWarnings, editWarning, pardonWarning } = require('../src/warningService');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

function describe(record) {
  const expiry = record.expiresAt ? '<t:' + Math.floor(record.expiresAt / 1000) + ':F>' : 'never';
  return [
    '**Case ' + record.id + '**',
    'Member: <@' + record.memberId + '>',
    'Status: **' + record.status + '**',
    'Points: **' + record.points + '**',
    'Source: **' + record.source + '**',
    'Reason: ' + record.reason,
    'Expires: ' + expiry,
    record.evidence ? 'Evidence: ' + record.evidence : '',
    'Delivery: **' + (record.delivery?.status || 'unknown') + '**',
    'Enforcement events: **' + record.enforcementEvents.length + '**',
  ].filter(Boolean).join('\n');
}

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
      await interaction.reply({ content: 'Only administrators or the configured staff role can manage cases.', flags: EPHEMERAL });
      return;
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    const subcommand = interaction.options.getSubcommand();
    const caseId = interaction.options.getString('case_id', true);
    try {
      if (subcommand === 'view') {
        const record = store.getCase(interaction.guildId, caseId);
        if (!record) throw new Error('Warning case was not found.');
        await interaction.editReply({ content: describe(record), allowedMentions: { parse: [] } });
        return;
      }
      if (subcommand === 'pardon') {
        const result = await pardonWarning({
          guild: interaction.guild,
          caseId,
          moderatorId: interaction.user.id,
          reason: interaction.options.getString('reason', true),
        });
        await interaction.editReply({ content: 'Pardoned **' + result.case.id + '**. Member now has **' + result.points + '** active point(s).' });
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
      const result = await editWarning({ guild: interaction.guild, caseId, patch });
      await interaction.editReply({ content: 'Updated **' + result.case.id + '**. Member now has **' + result.points + '** active point(s).' });
    } catch (error) {
      await interaction.editReply({ content: 'Could not manage case: ' + (error?.message || 'Unknown error.') });
    }
  },
};
