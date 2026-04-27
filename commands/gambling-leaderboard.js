const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { getAllGamblingStats } = require('../src/gamblingStore');
const { buildGamblingLeaderboardImage } = require('../src/gamblingLeaderboardManager');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

const TYPE_OPTIONS = [
  { label: 'Money Earned (all time)', value: 'money', description: 'Total PRcoin earned from gambling games.' },
  { label: 'Trivia best run', value: 'trivia', description: 'Best trivia score reached in one run.' },
  { label: 'Minefield completed', value: 'minefield', description: 'Total completed minefield games.' },
];

function getDifficultyOptions(type) {
  if (type === 'trivia') {
    return ['all', 'easy', 'medium', 'hard'];
  }
  if (type === 'minefield') {
    return ['all', 'easy', 'medium', 'hard', 'hardcore'];
  }
  return [];
}

function difficultyLabel(type, difficulty) {
  if (difficulty === 'all') return 'All';
  if (type === 'minefield' && difficulty === 'hardcore') return '💀 HARDCORE';
  if (difficulty === 'easy') return '🟢 Easy';
  if (difficulty === 'medium') return '🟡 Medium';
  if (difficulty === 'hard') return '🔴 Hard';
  return difficulty;
}

function parseState(customId) {
  const parts = customId.split(':');
  return {
    ownerId: parts[2],
    type: parts[3] || 'money',
    difficulty: parts[4] || 'all',
  };
}

function buildControls(ownerId, type, selectedDifficulty) {
  const rows = [];
  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`gamblinglb:type:${ownerId}:${type}:${selectedDifficulty}`)
      .setPlaceholder('Select leaderboard type')
      .addOptions(TYPE_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
        description: option.description,
        default: option.value === type,
      }))),
  );
  rows.push(select.toJSON());

  const difficultyOptions = getDifficultyOptions(type);
  if (difficultyOptions.length > 0) {
    const buttons = difficultyOptions.map((difficulty) => new ButtonBuilder()
      .setCustomId(`gamblinglb:filter:${ownerId}:${type}:${difficulty}`)
      .setLabel(difficultyLabel(type, difficulty))
      .setStyle(difficulty === selectedDifficulty ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(difficulty === selectedDifficulty));
    rows.push(new ActionRowBuilder().addComponents(buttons).toJSON());
  }

  return rows;
}

function getScore(type, difficulty, stats) {
  if (type === 'money') return Math.max(0, Math.floor(Number(stats.moneyEarned) || 0));
  if (type === 'trivia') return Math.max(0, Math.floor(Number(stats.triviaBestRun?.[difficulty]) || 0));
  if (type === 'minefield') return Math.max(0, Math.floor(Number(stats.minefieldCompleted?.[difficulty]) || 0));
  return 0;
}

function getTitle(type, difficulty) {
  if (type === 'money') return 'Money Earned (All Time)';
  if (type === 'trivia') return `Trivia best run • ${difficultyLabel(type, difficulty)}`;
  if (type === 'minefield') return `Minefield completed • ${difficultyLabel(type, difficulty)}`;
  return 'Gambling leaderboard';
}

function getMetricLabel(type) {
  if (type === 'money') return 'PRcoin';
  if (type === 'trivia') return 'Correct';
  return 'Completed';
}

async function sendLeaderboard(target, guild, ownerId, type = 'money', difficulty = 'all') {
  const allStats = getAllGamblingStats();
  const rows = Object.entries(allStats)
    .map(([userId, stats]) => ({ userId, score: getScore(type, difficulty, stats) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const rowsWithMeta = await Promise.all(rows.map(async (row) => {
    let member = guild.members.cache.get(row.userId);
    if (!member) {
      member = await guild.members.fetch(row.userId).catch(() => null);
    }
    return {
      ...row,
      username: member?.user?.username || `Unknown (${row.userId})`,
      avatarUrl: member?.user?.displayAvatarURL({ extension: 'png', size: 128 }) || '',
      displayValue: String(row.score),
    };
  }));

  const attachment = await buildGamblingLeaderboardImage({
    guildName: guild.name,
    title: getTitle(type, difficulty),
    metricLabel: getMetricLabel(type),
    rows: rowsWithMeta,
  });

  const payload = {
    flags: COMPONENTS_V2_FLAG,
    files: [attachment],
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: [
              `## ${guild.name}'s gambling leaderboard.`,
              `-# Category: **${getTitle(type, difficulty)}**`,
            ].join('\n'),
          },
          {
            type: 12,
            items: [{ media: { url: 'attachment://gambling-leaderboard.png' } }],
          },
          { type: 14, divider: true, spacing: 1 },
          ...buildControls(ownerId, type, difficulty),
        ],
      },
    ],
  };

  if (target.isStringSelectMenu?.() || target.isButton?.()) {
    await target.update(payload);
    return;
  }

  await target.reply(payload);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gambling-leaderboard')
    .setDescription('Show gambling leaderboard'),

  async execute(interaction) {
    await sendLeaderboard(interaction, interaction.guild, interaction.user.id, 'money', 'all');
  },

  async handleInteraction(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('gamblinglb:type:')) {
      const { ownerId, difficulty } = parseState(interaction.customId);
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own gambling leaderboard command.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const type = interaction.values?.[0] || 'money';
      const fallbackDifficulty = getDifficultyOptions(type).includes(difficulty) ? difficulty : 'all';
      await sendLeaderboard(interaction, interaction.guild, ownerId, type, fallbackDifficulty);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('gamblinglb:filter:')) {
      const { ownerId, type, difficulty } = parseState(interaction.customId);
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own gambling leaderboard command.', flags: MessageFlags.Ephemeral });
        return true;
      }
      await sendLeaderboard(interaction, interaction.guild, ownerId, type, difficulty);
      return true;
    }

    return false;
  },
};
