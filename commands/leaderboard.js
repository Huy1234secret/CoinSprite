const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const manager = require('../src/levelingManager');

const TYPES = ['xp', 'messages', 'reactions'];
const PAGE_SIZE = 10;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const LEADERBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const activeLeaderboardMessages = new Map();
let leaderboardScheduler = null;
let schedulerClient = null;

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

function leaderboardButton(type, page, maxPage, ownerId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leaderboard:jump:${ownerId}:${type}:${maxPage}`)
      .setLabel(`Page ${page} / ${maxPage}`)
      .setStyle(ButtonStyle.Secondary),
  );
}

function leaderboardTypeSelect(selectedType, ownerId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`leaderboard:type:${ownerId}`)
      .setPlaceholder('Leaderboard type')
      .addOptions(
        {
          label: 'Total XP',
          value: 'xp',
          default: selectedType === 'xp',
        },
        {
          label: 'Messages',
          value: 'messages',
          default: selectedType === 'messages',
        },
        {
          label: 'Reaction',
          value: 'reactions',
          default: selectedType === 'reactions',
        },
      ),
  );
}

async function sendLeaderboard(target, guild, userId, type, page) {
  const leaderboard = manager.getSortedLeaderboard(guild.id);
  const { rows, finalPage, maxPage, sorted } = buildRows(leaderboard, type, page);
  const nextUpdateUnix = Math.floor(getNextFiveMinuteRefresh().getTime() / 1000);

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
  const attachmentName = attachment.name || 'leaderboard.png';

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
              `## ${guild.name}'s leaderboard.`,
              `-# You placed ${place} on the ${getTypeLabel(type)} leaderboard.`,
              `-# Auto-refresh timer: <t:${nextUpdateUnix}:R> (<t:${nextUpdateUnix}:T>)`,
            ].join('\n'),
          },
          {
            type: 12,
            items: [{ media: { url: `attachment://${attachmentName}` } }],
          },
          { type: 14, divider: true, spacing: 1 },
          leaderboardButton(type, finalPage, maxPage, userId).toJSON(),
          leaderboardTypeSelect(type, userId).toJSON(),
        ],
      },
    ],
  };

  if (typeof target.update === 'function' && !target.deferred && !target.replied) return target.update(payload);
  if (typeof target.editReply === 'function' && (target.deferred || target.replied)) return target.editReply(payload);
  if (typeof target.edit === 'function') return target.edit(payload);
  if (typeof target.reply === 'function') return target.reply(payload);
  if (typeof target.followUp === 'function') return target.followUp(payload);
  return null;
}

function getNextFiveMinuteRefresh(now = new Date()) {
  const next = new Date(now.getTime());
  const minutes = next.getUTCMinutes();
  const nextMinutes = (Math.floor(minutes / 5) + 1) * 5;
  next.setUTCMinutes(nextMinutes, 0, 0);
  return next;
}

function rememberLeaderboardMessage(message, state) {
  if (!message?.id || !message?.channelId || !message?.guildId) return;
  activeLeaderboardMessages.set(message.id, {
    ownerId: state.ownerId,
    guildId: message.guildId,
    channelId: message.channelId,
    type: state.type,
    page: state.page,
  });
}

async function refreshTrackedLeaderboards() {
  if (!schedulerClient) return;
  for (const [messageId, state] of activeLeaderboardMessages.entries()) {
    const guild = schedulerClient.guilds.cache.get(state.guildId)
      || await schedulerClient.guilds.fetch(state.guildId).catch(() => null);
    if (!guild) continue;
    const channel = guild.channels.cache.get(state.channelId)
      || await guild.channels.fetch(state.channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) continue;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      activeLeaderboardMessages.delete(messageId);
      continue;
    }
    await sendLeaderboard(message, guild, state.ownerId, state.type, state.page).catch(() => null);
  }
}

function scheduleLeaderboardRefresh() {
  if (leaderboardScheduler) clearTimeout(leaderboardScheduler);
  const delay = Math.max(1_000, Math.min(LEADERBOARD_REFRESH_INTERVAL_MS, getNextFiveMinuteRefresh().getTime() - Date.now()));
  leaderboardScheduler = setTimeout(async () => {
    await refreshTrackedLeaderboards().catch(() => null);
    scheduleLeaderboardRefresh();
  }, delay);
}

async function deferForLeaderboard(interaction) {
  if (interaction.isChatInputCommand?.() && !interaction.deferred && !interaction.replied) {
    await interaction.deferReply().catch(() => null);
    return;
  }

  if ((interaction.isButton?.() || interaction.isStringSelectMenu?.())
    && !interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => null);
    return;
  }

  if (interaction.isModalSubmit?.() && !interaction.deferred && !interaction.replied) {
    if (typeof interaction.deferUpdate === 'function') {
      await interaction.deferUpdate().catch(() => null);
      return;
    }
    await interaction.deferReply().catch(() => null);
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

  async init(client) {
    schedulerClient = client;
    scheduleLeaderboardRefresh();
  },

  async execute(interaction) {
    const type = interaction.options.getString('type') || 'xp';
    await deferForLeaderboard(interaction);
    await sendLeaderboard(interaction, interaction.guild, interaction.user.id, type, 1);
    const message = await interaction.fetchReply().catch(() => null);
    rememberLeaderboardMessage(message, {
      ownerId: interaction.user.id,
      type,
      page: 1,
    });
  },

  async handleInteraction(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('leaderboard:jump:')) {
      const [, , ownerId, type, maxPageRaw] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own leaderboard command.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const maxPage = Math.max(1, Number(maxPageRaw) || 1);

      const modal = new ModalBuilder()
        .setCustomId(`leaderboard:modal:${ownerId}:${type}:${maxPage}`)
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
      const [, , ownerId, type, maxPageRaw] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own leaderboard command.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const maxPage = Math.max(1, Number(maxPageRaw) || 1);
      const asked = Number(interaction.fields.getTextInputValue('page_input'));
      const page = Number.isFinite(asked) ? Math.min(Math.max(1, Math.floor(asked)), maxPage) : 1;
      await deferForLeaderboard(interaction);
      await sendLeaderboard(interaction, interaction.guild, interaction.user.id, TYPES.includes(type) ? type : 'xp', page);
      const message = interaction.message || await interaction.fetchReply().catch(() => null);
      rememberLeaderboardMessage(message, {
        ownerId: interaction.user.id,
        type: TYPES.includes(type) ? type : 'xp',
        page,
      });
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('leaderboard:type:')) {
      const [, , ownerId] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own leaderboard command.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const selectedType = interaction.values?.[0];
      await deferForLeaderboard(interaction);
      await sendLeaderboard(interaction, interaction.guild, interaction.user.id, TYPES.includes(selectedType) ? selectedType : 'xp', 1);
      const message = interaction.message || await interaction.fetchReply().catch(() => null);
      rememberLeaderboardMessage(message, {
        ownerId: interaction.user.id,
        type: TYPES.includes(selectedType) ? selectedType : 'xp',
        page: 1,
      });
      return true;
    }

    return false;
  },
};
