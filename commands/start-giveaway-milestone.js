const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const { loadState, saveState } = require('../src/milestoneStore');

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const PING_ROLE_ID = '1493901068688429207';

let clientRef = null;
let refreshTimer = null;

function percent(current, target) {
  if (!target || target <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor((current / target) * 100)));
}

function progressBar(current, target, size = 18) {
  const pct = percent(current, target);
  const filled = Math.round((pct / 100) * size);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, size - filled))} ${pct}%`;
}

function normalizeRewards(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function buildMilestonePayload(state, userCount, reached = false) {
  const pct = percent(userCount, state.milestoneUsers);
  const nextRefresh = Math.floor((Date.now() + REFRESH_INTERVAL_MS) / 1000);
  const rewardLines = state.rewardLines.length
    ? state.rewardLines.map((line) => `• ${line}`).join('\n')
    : '• Surprise reward';

  const progressText = progressBar(userCount, state.milestoneUsers);
  const summary = `${userCount} / ${state.milestoneUsers} (${pct}%)`;

  const baseTitle = reached
    ? '## 🎯 MILESTONE REACHED! 🏆\nA giveaway will begin soon!'
    : '## 🎯 MILESTONE\nA giveaway will begin when we reached the milestone!';

  const giveawaySection = reached
    ? `🎁Giveaway prize:\n${rewardLines}`
    : `🎁Giveaway prize:\n${rewardLines}\n-# Refresh <t:${nextRefresh}:R>`;

  return {
    flags: COMPONENTS_V2_FLAG,
    content: reached ? `<@&${PING_ROLE_ID}>` : '',
    components: [
      {
        type: 17,
        accent_color: 0x00ff00,
        components: [
          {
            type: 10,
            content: baseTitle,
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: progressText,
              },
            ],
            accessory: {
              type: 2,
              style: 2,
              custom_id: `milestone_status_${state.guildId}`,
              label: summary,
              disabled: true,
            },
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          {
            type: 10,
            content: giveawaySection,
          },
        ],
      },
    ],
  };
}

async function getHumanMemberCount(guild) {
  const members = await guild.members.fetch();
  return members.filter((member) => !member.user.bot).size;
}

function upsertMilestoneState(nextState) {
  const state = loadState();
  const filtered = state.milestones.filter((m) => m.guildId !== nextState.guildId);
  filtered.push(nextState);
  saveState({ milestones: filtered });
}

async function refreshMilestoneEntry(entry) {
  if (!clientRef) {
    return;
  }

  const guild = await clientRef.guilds.fetch(entry.guildId).catch(() => null);
  if (!guild) {
    return;
  }

  const channel = await guild.channels.fetch(entry.channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }

  const humanCount = await getHumanMemberCount(guild);
  const reached = humanCount >= entry.milestoneUsers;

  if (!reached) {
    const payload = buildMilestonePayload(entry, humanCount, false);
    await channel.messages.edit(entry.messageId, payload).catch(() => null);
    upsertMilestoneState({ ...entry, lastKnownUsers: humanCount, reached: false, updatedAt: Date.now() });
    return;
  }

  if (!entry.reached) {
    await channel.messages.delete(entry.messageId).catch(() => null);
    const reachedPayload = buildMilestonePayload(entry, humanCount, true);
    const reachedMessage = await channel.send(reachedPayload);

    upsertMilestoneState({
      ...entry,
      messageId: reachedMessage.id,
      lastKnownUsers: humanCount,
      reached: true,
      updatedAt: Date.now(),
    });
    return;
  }

  const reachedPayload = buildMilestonePayload(entry, humanCount, true);
  await channel.messages.edit(entry.messageId, reachedPayload).catch(() => null);
  upsertMilestoneState({ ...entry, lastKnownUsers: humanCount, reached: true, updatedAt: Date.now() });
}

async function refreshAllMilestones() {
  const state = loadState();
  for (const entry of state.milestones) {
    try {
      await refreshMilestoneEntry(entry);
    } catch (error) {
      console.error(`Failed to refresh milestone for guild ${entry.guildId}:`, error);
    }
  }
}

function startRefreshWorker() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = setInterval(() => {
    void refreshAllMilestones();
  }, REFRESH_INTERVAL_MS);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start-giveaway-milestone')
    .setDescription('Start a milestone-tracked giveaway panel.'),

  async init(client) {
    clientRef = client;
    startRefreshWorker();
    await refreshAllMilestones();
  },

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('milestone_modal_create')
      .setTitle('Start Giveaway Milestone');

    const rewardInput = new TextInputBuilder()
      .setCustomId('milestone_reward')
      .setLabel('Giveaway Reward')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder('List giveaway rewards (one per line).')
      .setMaxLength(1800);

    const winnerInput = new TextInputBuilder()
      .setCustomId('milestone_winner')
      .setLabel('Winner (number only)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Example: 3')
      .setMaxLength(5);

    const milestoneInput = new TextInputBuilder()
      .setCustomId('milestone_users')
      .setLabel('User milestone (number only)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder('Example: 500')
      .setMaxLength(7);

    modal.addComponents(
      new ActionRowBuilder().addComponents(rewardInput),
      new ActionRowBuilder().addComponents(winnerInput),
      new ActionRowBuilder().addComponents(milestoneInput),
    );

    await interaction.showModal(modal);
  },

  async handleInteraction(interaction) {
    if (!interaction.isModalSubmit() || interaction.customId !== 'milestone_modal_create') {
      return false;
    }

    const rewardText = interaction.fields.getTextInputValue('milestone_reward').trim();
    const winnerRaw = interaction.fields.getTextInputValue('milestone_winner').trim();
    const milestoneRaw = interaction.fields.getTextInputValue('milestone_users').trim();

    if (!/^\d+$/.test(winnerRaw) || !/^\d+$/.test(milestoneRaw)) {
      await interaction.reply({
        content: 'Winner and User milestone must be numbers only.',
        ephemeral: true,
      });
      return true;
    }

    const winnerCount = Number(winnerRaw);
    const milestoneUsers = Number(milestoneRaw);
    if (winnerCount <= 0 || milestoneUsers <= 0) {
      await interaction.reply({
        content: 'Winner and User milestone must be greater than 0.',
        ephemeral: true,
      });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    const humanCount = await getHumanMemberCount(interaction.guild);
    const rewardLines = normalizeRewards(rewardText);

    const existing = loadState().milestones.find((m) => m.guildId === interaction.guildId);
    if (existing) {
      await interaction.channel.messages.delete(existing.messageId).catch(() => null);
    }

    const stateEntry = {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: '',
      rewardText,
      rewardLines,
      winnerCount,
      milestoneUsers,
      createdBy: interaction.user.id,
      reached: false,
      lastKnownUsers: humanCount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const panel = await interaction.channel.send(buildMilestonePayload(stateEntry, humanCount, false));

    stateEntry.messageId = panel.id;
    upsertMilestoneState(stateEntry);

    await interaction.editReply({
      content: `Milestone giveaway panel started.\nTarget: **${milestoneUsers} users**\nWinners: **${winnerCount}**`,
    });

    return true;
  },
};
