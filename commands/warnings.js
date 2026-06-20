const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const store = require('../src/moderationCaseStore');
const { canManageWarnings } = require('../src/warningService');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

function caseLine(record) {
  const expiry = record.expiresAt ? '<t:' + Math.floor(record.expiresAt / 1000) + ':R>' : 'never';
  return '**' + record.id + '** · ' + record.points + ' point(s) · ' + record.status + ' · expires ' + expiry + '\n' + record.reason;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View your warning history or inspect another member as staff.')
    .addUserOption((option) => option.setName('member').setDescription('Member to inspect (staff only)')),

  async execute(interaction) {
    const requested = interaction.options.getUser('member');
    const target = requested || interaction.user;
    if (target.id !== interaction.user.id && !canManageWarnings(interaction.member)) {
      await interaction.reply({ content: 'Only administrators or the configured staff role can view another member’s warnings.', flags: EPHEMERAL });
      return;
    }
    const cases = store.listCases(interaction.guildId, { memberId: target.id });
    const activePoints = store.activePoints(interaction.guildId, target.id);
    const lines = cases.slice(0, 10).map(caseLine);
    await interaction.reply({
      content: [
        '**Warning history for ' + target.username + '**',
        'Active points: **' + activePoints + '**',
        lines.length ? lines.join('\n\n') : 'No warning cases.',
        cases.length > 10 ? '\nShowing 10 of ' + cases.length + ' cases.' : '',
      ].filter(Boolean).join('\n\n').slice(0, 2000),
      flags: EPHEMERAL,
      allowedMentions: { parse: [] },
    });
  },
};
