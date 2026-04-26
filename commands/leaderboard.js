const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const manager = require('../src/levelingManager');

const TYPES = ['xp', 'messages', 'reactions'];
const PAGE_SIZE = 10;

function getTypeLabel(type) {
  if (type === 'messages') {
    return 'Messages';
  }
  if (type === 'reactions') {
    return 'Reaction';
  }
  return 'Total XP';
}

function buildRows(leaderboard, type, page) {
  const sorted = [...leaderboard].sort((a, b) => {
    const aValue = type === 'xp' ? a.totalXp : type === 'messages' ? a.messages : a.reactions;
    const bValue = type === 'xp' ? b.totalXp : type === 'messages' ? b.messages : b.reactions;
    return bValue - aValue;
  });

  const maxPage = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const finalPage = Math.min(Math.max(1, page), maxPage);
  const start = (finalPage - 1) * PAGE_SIZE;
  const rows = sorted.slice(start, start + PAGE_SIZE).map((item, idx) => ({
    ...item,
    rank: start + idx + 1,
  }));

  return { rows, finalPage, maxPage, sorted };
}

function leaderboardButton(type, page, maxPage) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leaderboard:jump:${type}:${maxPage}`)
      .setLabel(`Page ${page} / ${maxPage}`)
      .setStyle(ButtonStyle.Secondary),
  );
}

function leaderboardTypeSelector() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('leaderboard:type-select')
      .setPlaceholder('Change leaderboard type')
      .addOptions(
        { label: 'Total XP', value: 'xp' },
        { label: 'Messages', value: 'messages' },
        { label: 'Reactions', value: 'reactions' },
      ),
  );
}

async function sendLeaderboard(target, guild, userId, type, page) {
  const leaderboard = manager.getSortedLeaderboard(guild.id);
  const { rows, finalPage, maxPage, sorted } = buildRows(leaderboard, type, page);

  const rowsWithMeta = await Promise.all(rows.map(async (row) => {
    let member = guild.members.cache.get(row.userId);
    if (!member) {
      member = await guild.members.fetch(row.userId).catch(() => null);
    }

    const username = member?.user?.username || `Unknown (${row.userId})`;
    const avatarUrl = member?.user?.displayAvatarURL({ extension: 'png', size: 128 }) || '';
    return { ...row, username, avatarUrl };
  }));

  const place = Math.max(1, sorted.findIndex((entry) => entry.userId === userId) + 1);
  const attachment = await manager.buildLeaderboardImage({
    guildName: guild.name,
    rows: rowsWithMeta,
    type,
    page: finalPage,
    maxPage,
  });

  const payload = {
    content: `## ${guild.name}'s leaderboard.\n-# You placed ${place} on the ${getTypeLabel(type)} leaderboard`,
    files: [attachment],
    components: [leaderboardButton(type, finalPage, maxPage), leaderboardTypeSelector()],
  };

  if (typeof target.reply === 'function') {
    await target.reply(payload);
  } else {
    await target.followUp(payload);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show server leaderboard')
    .addStringOption((option) => option
      .setName('type')
      .setDescription('Leaderboard type')
      .setRequired(false)
      .addChoices(
        { name: 'Total XP', value: 'xp' },
        { name: 'Messages', value: 'messages' },
        { name: 'Reaction', value: 'reactions' },
      )),

  async execute(interaction) {
    const type = interaction.options.getString('type') || 'xp';
    await sendLeaderboard(interaction, interaction.guild, interaction.user.id, type, 1);
  },

  async handleInteraction(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('leaderboard:jump:')) {
      const [, , type, maxPageRaw] = interaction.customId.split(':');
      const maxPage = Math.max(1, Number(maxPageRaw) || 1);

      const modal = new ModalBuilder()
        .setCustomId(`leaderboard:modal:${type}:${maxPage}`)
        .setTitle('Switch leaderboard page');
      const input = new TextInputBuilder()
        .setCustomId('page_input')
        .setLabel('Which page u wanna switch to')
        .setPlaceholder(`Page 1 - ${maxPage}`)
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('leaderboard:modal:')) {
      const [, , type, maxPageRaw] = interaction.customId.split(':');
      const maxPage = Math.max(1, Number(maxPageRaw) || 1);
      const asked = Number(interaction.fields.getTextInputValue('page_input'));
      const page = Number.isFinite(asked) ? Math.min(Math.max(1, Math.floor(asked)), maxPage) : 1;
      await sendLeaderboard(interaction, interaction.guild, interaction.user.id, TYPES.includes(type) ? type : 'xp', page);
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'leaderboard:type-select') {
      const type = TYPES.includes(interaction.values[0]) ? interaction.values[0] : 'xp';
      await sendLeaderboard(interaction, interaction.guild, interaction.user.id, type, 1);
      return true;
    }

    return false;
  },
};
