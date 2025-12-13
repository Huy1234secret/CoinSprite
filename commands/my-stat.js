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
    '- how to earn xp in server stat',
    '+ Server stat is user doing activities in the server like chatting, voice chatting, etc',
    '+ Every 1 msg user send give 1 - 5 XP',
    '+ Every 1 minutes in voice channel [not need turn on voice] will earn 3 XP. Note the bot will count total minutes user stayed and calculate the total XP upon user left voice chat [change voice chat doesn\'t count]',
    '+ Every 1 command, action [like button, selection panel] do give 1 XP',
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
  data: new SlashCommandBuilder().setName('my-stat').setDescription('View your server stats.'),

  async execute(interaction) {
    const stats = addXpToUser(interaction.user.id, 0);
    await interaction.reply(buildStatMessage(interaction.user, stats));
  },
};
