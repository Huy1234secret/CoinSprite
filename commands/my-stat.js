const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { addXpToUser, buildProgressBar, getNextLevelRequirement } = require('../src/userStats');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;

function formatProgress(stats) {
  if (stats.level >= 100) {
    return {
      bar: buildProgressBar(1, 1),
      label: '`MAX LEVEL - 100%`',
    };
  }

  const requirement = getNextLevelRequirement(stats.level) ?? 1;
  const bar = buildProgressBar(stats.xp, requirement);
  const percent = Math.min(100, Math.max(0, Math.round((stats.xp / requirement) * 100)));
  return {
    bar,
    label: `\`${stats.xp}/${requirement} - ${percent}%\``,
  };
}

function buildStatMessage(user, stats) {
  const { bar, label } = formatProgress(stats);
  const lines = [
    `## ${user.username} Server Stat`,
    `User level: ${stats.level}`,
    `-# ${bar} ${label}`,
  ];

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [{ type: 10, content: lines.join('\n') }],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder().setName('my-stat').setDescription('View your stat level in this group!'),

  async execute(interaction) {
    const stats = addXpToUser(interaction.user.id, 0);
    await interaction.reply(buildStatMessage(interaction.user, stats));
  },
};
