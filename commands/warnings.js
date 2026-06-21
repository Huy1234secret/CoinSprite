const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const store = require('../src/moderationCaseStore');
const { canManageWarnings } = require('../src/warningService');
const {
  COMPONENTS_V2_FLAG,
  caseHistoryContainer,
  moderationErrorContainer,
} = require('../src/moderationComponents');

const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const RESPONSE_FLAGS = EPHEMERAL | COMPONENTS_V2_FLAG;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View your warning history or inspect another member as staff.')
    .addUserOption((option) => option.setName('member').setDescription('Member to inspect (staff only)')),

  async execute(interaction) {
    const requested = interaction.options.getUser('member');
    const target = requested || interaction.user;
    if (target.id !== interaction.user.id && !canManageWarnings(interaction.member)) {
      await interaction.reply({
        ...moderationErrorContainer('Warning history unavailable', 'Only administrators or the configured staff role can view another member’s warnings.'),
        flags: RESPONSE_FLAGS,
      });
      return;
    }
    const cases = store.listCases(interaction.guildId, { targetUserId: target.id });
    const activePoints = store.activePoints(interaction.guildId, target.id);
    await interaction.reply({
      ...caseHistoryContainer({ target, cases, activePoints }),
      flags: RESPONSE_FLAGS,
    });
  },
};
