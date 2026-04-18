const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { logCommandSystem } = require('./commandLogger');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;

const PANEL_CHANNEL_ID = '1493971939545583836';
const TICKET_CATEGORY_ID = '1493971752680947802';
const TRANSCRIPT_CHANNEL_ID = '1493974187285418157';
const ADMIN_ROLE_ID = '1494993523064443065';

const STORE_PATH = path.join(__dirname, '..', 'data', 'ticket-state.json');
const TRANSCRIPT_DIR = path.join(__dirname, '..', 'transcripts');

const TICKET_TYPES = {
  guild_support: {
    key: 'guild_support',
    label: 'Guild Support',
    channelLabel: 'Guild Support',
    description: 'Use this ticket for guild help, member issues, questions, or other guild-related support.',
    emoji: '🛡️',
  },
  claim_reward: {
    key: 'claim_reward',
    label: 'Claim Reward',
    channelLabel: 'Claim Reward',
    description: 'Use this ticket if you want to claim a reward. Please provide proof or details when needed.',
    emoji: '🎁',
  },
};

let initialized = false;

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify(
        {
          panelMessageId: null,
          nextTicketNumber: 0,
          blacklistedUsers: {},
          tickets: {},
          updatedAt: Date.now(),
        },
        null,
        2,
      ),
      'utf8',
    );
  }
}

function loadState() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid state payload.');
    }

    parsed.panelMessageId = parsed.panelMessageId ?? null;
    parsed.nextTicketNumber = Number.isInteger(parsed.nextTicketNumber) ? parsed.nextTicketNumber : 0;
    parsed.blacklistedUsers = parsed.blacklistedUsers && typeof parsed.blacklistedUsers === 'object' ? parsed.blacklistedUsers : {};
    parsed.tickets = parsed.tickets && typeof parsed.tickets === 'object' ? parsed.tickets : {};
    parsed.updatedAt = parsed.updatedAt ?? Date.now();
    return parsed;
  } catch {
    return {
      panelMessageId: null,
      nextTicketNumber: 0,
      blacklistedUsers: {},
      tickets: {},
      updatedAt: Date.now(),
    };
  }
}

function saveState(state) {
  ensureStoreFile();
  state.updatedAt = Date.now();
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function padTicketNumber(number) {
  return String(number).padStart(4, '0');
}

function formatTicketChannelName(typeLabel, ticketId) {
  return `${typeLabel.toLowerCase().replace(/\s+/g, '-')}-${ticketId}`;
}

function buildPanelPayload(guild) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 9,
            components: [{ type: 10, content: 'Support Ticket' }],
            accessory: guild.iconURL() ? { type: 11, media: { url: guild.iconURL() } } : undefined,
          },
          { type: 10, content: 'Need help? Please open the correct ticket type below.' },
          { type: 14, divider: true, spacing: 0 },
          {
            type: 10,
            content:
              '-# ⚠️ Please do not open joke, false, or duplicate tickets.\n-# 📌 Please be patient after opening a ticket. Staff will respond as soon as possible.',
          },
          { type: 14, divider: true, spacing: 0 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: 'ticket:type-select',
                placeholder: 'Choose a ticket type',
                options: [
                  {
                    label: TICKET_TYPES.guild_support.label,
                    description: TICKET_TYPES.guild_support.description,
                    value: TICKET_TYPES.guild_support.key,
                    emoji: { name: TICKET_TYPES.guild_support.emoji },
                  },
                  {
                    label: TICKET_TYPES.claim_reward.label,
                    description: TICKET_TYPES.claim_reward.description,
                    value: TICKET_TYPES.claim_reward.key,
                    emoji: { name: TICKET_TYPES.claim_reward.emoji },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildTicketActionSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket:actions')
      .setPlaceholder('Ticket Actions')
      .addOptions(
        {
          label: 'Close Ticket',
          value: 'close',
          emoji: '⛔',
        },
        {
          label: 'Blacklist User',
          value: 'blacklist',
          emoji: '💀',
        },
      ),
  );
}

function buildGuildSupportModal() {
  return {
    custom_id: 'ticket:modal:guild_support',
    title: 'Guild Support Form',
    components: [
      {
        type: 18,
        label: 'Support type',
        description: 'Choose the type of guild support you need.',
        component: {
          type: 21,
          custom_id: 'support_kind',
          required: true,
          options: [
            {
              value: 'report_member',
              label: 'Report Member',
              description: 'Report a guild member issue',
            },
            {
              value: 'other',
              label: 'Other',
              description: 'Any other guild support request',
            },
          ],
        },
      },
    ],
  };
}

function buildClaimRewardModal() {
  return {
    custom_id: 'ticket:modal:claim_reward',
    title: 'Claim Reward Form',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'roblox_username',
            style: 2,
            label: 'What is your Roblox username?',
            required: true,
            max_length: 200,
          },
        ],
      },
    ],
  };
}

function getGuildSupportSelection(interaction) {
  const modalComponents = Array.isArray(interaction.components) ? interaction.components : [];

  for (const container of modalComponents) {
    const radio = container?.component;
    if (radio?.type === 21 && radio.customId === 'support_kind') {
      return radio.value ?? null;
    }
  }

  const rawInteraction = interaction.toJSON?.() ?? null;
  const rawComponents = rawInteraction?.data?.components;
  if (Array.isArray(rawComponents)) {
    for (const container of rawComponents) {
      const radio = container?.component;
      if (radio?.type === 21 && radio.custom_id === 'support_kind') {
        return radio.value ?? null;
      }
    }
  }

  return null;
}

function formatGuildSupportAnswer(value) {
  if (value === 'report_member') {
    return 'Report Member';
  }

  if (value === 'other') {
    return 'Other';
  }

  return null;
}

async function ensurePanelMessage(guild, force = false) {
  const state = loadState();
  const channel = await guild.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    logCommandSystem(`[TicketSystem] Panel channel ${PANEL_CHANNEL_ID} not found or not text-based.`);
    return false;
  }

  const payload = buildPanelPayload(guild);
  let panelMessage = null;

  if (!force && state.panelMessageId) {
    panelMessage = await channel.messages.fetch(state.panelMessageId).catch(() => null);
    if (panelMessage) {
      await panelMessage.edit(payload).catch(() => null);
    }
  }

  if (!panelMessage && !force) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    panelMessage = recent?.find((message) => message.author.id === guild.client.user.id && message.components.length > 0) ?? null;
    if (panelMessage) {
      await panelMessage.edit(payload).catch(() => null);
    }
  }

  if (!panelMessage) {
    panelMessage = await channel.send(payload).catch(() => null);
  }

  if (!panelMessage) {
    logCommandSystem('[TicketSystem] Failed to send or update panel message.');
    return false;
  }

  state.panelMessageId = panelMessage.id;
  saveState(state);
  logCommandSystem(`[TicketSystem] Panel message ensured in channel ${PANEL_CHANNEL_ID} (${panelMessage.id}).`);
  return true;
}

function getDateStamp(now = new Date()) {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const year = now.getUTCFullYear();
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  return {
    display: `${month}/${day}/${year} ${minutes}:${hours}`,
    fileSafe: `${month}-${day}-${year}_${minutes}-${hours}`,
  };
}

function formatTranscriptLine(message) {
  const timestamp = message.createdAt ?? new Date();
  const mm = String(timestamp.getUTCMinutes()).padStart(2, '0');
  const hh = String(timestamp.getUTCHours()).padStart(2, '0');
  const displayName = message.author?.username ?? 'UnknownUser';
  const userId = message.author?.id ?? 'unknown';
  const content = (message.content || '[No text content]').replace(/\r?\n/g, ' | ').trim();
  return `${mm}:${hh} // ${displayName} - ${userId}: ${content}`;
}

async function createTicketFromModal(interaction, ticketType, formQuestion, formAnswer) {
  const state = loadState();
  const userId = interaction.user.id;

  if (state.blacklistedUsers[userId]?.active) {
    await interaction.reply({
      content: 'You are blacklisted from the ticket system.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  const ticketIdRaw = state.nextTicketNumber;
  state.nextTicketNumber += 1;
  const ticketId = padTicketNumber(ticketIdRaw);

  const guild = interaction.guild;
  const channelName = formatTicketChannelName(ticketType.channelLabel, ticketId);

  const channel = await guild.channels
    .create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: userId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: ADMIN_ROLE_ID,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
          ],
        },
      ],
      topic: `ticket_type=${ticketType.key};ticket_id=${ticketId};owner=${userId}`,
      reason: `Support ticket created by ${interaction.user.tag}`,
    })
    .catch(() => null);

  if (!channel) {
    await interaction.reply({
      content: 'Failed to create the ticket channel. Please contact staff.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  state.tickets[channel.id] = {
    ownerId: userId,
    ticketType: ticketType.key,
    ticketTypeLabel: ticketType.label,
    ticketId,
    createdAt: Date.now(),
    formQuestion,
    formAnswer,
    closedAt: null,
    closedBy: null,
  };
  saveState(state);

  const payload = {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content:
              `<@${userId}> Welcome!\n**${ticketType.label} Ticket**\n* Our staff will be with you soon, please be patience and provide necessary information so the help will be faster!`,
          },
          { type: 14, divider: true, spacing: 0 },
          {
            type: 10,
            content: `${formQuestion}\n${formAnswer}`,
          },
          { type: 14, divider: true, spacing: 0 },
        ],
      },
    ],
    componentsV2: true,
  };

  await channel.send(payload).catch(() => null);
  await channel.send({ components: [buildTicketActionSelect()] }).catch(() => null);

  logCommandSystem(`[TicketSystem] Created ${ticketType.label} ticket ${ticketId} in channel ${channel.id} for user ${userId}.`);

  await interaction.reply({
    content: `Ticket created: ${channel}`,
    flags: EPHEMERAL_FLAG,
  });

  return true;
}

async function collectTranscript(channel, closerId, closeReason) {
  const messages = [];
  let lastId = null;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId ?? undefined }).catch(() => null);
    if (!batch || batch.size === 0) {
      break;
    }

    messages.push(...batch.values());
    lastId = batch.last().id;

    if (batch.size < 100) {
      break;
    }
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [
    `Ticket Channel: ${channel.name} (${channel.id})`,
    `Closed By: ${closerId}`,
    `Close Action: ${closeReason}`,
    ...messages.map((message) => formatTranscriptLine(message)),
  ];

  if (!fs.existsSync(TRANSCRIPT_DIR)) {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  }

  return lines.join('\n');
}

async function disableOwnerSendPermission(channelId, ownerId, guild) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    return;
  }

  await channel.permissionOverwrites
    .edit(ownerId, {
      SendMessages: false,
    })
    .catch(() => null);
}

async function closeTicket(interaction, action) {
  const state = loadState();
  const ticket = state.tickets[interaction.channelId];
  if (!ticket) {
    await interaction.reply({ content: 'This channel is not registered as a ticket.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: 'Ticket channel unavailable.', flags: EPHEMERAL_FLAG });
    return true;
  }

  await disableOwnerSendPermission(channel.id, ticket.ownerId, interaction.guild);

  if (action === 'blacklist') {
    state.blacklistedUsers[ticket.ownerId] = {
      active: true,
      reason: `Blacklisted via ticket ${ticket.ticketId} by ${interaction.user.id}`,
      updatedAt: Date.now(),
    };
    saveState(state);

    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: 0x000000,
          components: [{ type: 10, content: 'Blacklisted user from all ticket system.' }],
        },
      ],
    });
  } else {
    await interaction.reply({ content: 'Starting ticket close process...', flags: EPHEMERAL_FLAG });
  }

  await channel.send({
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: 0xffff00, components: [{ type: 10, content: 'Transcript saving!...' }] }],
  });

  const transcriptContent = await collectTranscript(channel, interaction.user.id, action);
  const now = new Date();
  const stamp = getDateStamp(now);
  const safeType = ticket.ticketTypeLabel.replace(/\s+/g, ' ');
  const fileName = `${safeType} - ${stamp.fileSafe}.txt`;
  const filePath = path.join(TRANSCRIPT_DIR, fileName);
  fs.writeFileSync(filePath, transcriptContent, 'utf8');

  const transcriptChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (transcriptChannel?.isTextBased()) {
    await transcriptChannel.send({
      content:
        `Transcript saved for **${ticket.ticketTypeLabel}** (#${ticket.ticketId}).\n` +
        `Closed by: <@${interaction.user.id}>\nOwner: <@${ticket.ownerId}>\nTimestamp: ${stamp.display}`,
      files: [{ attachment: filePath, name: fileName }],
    });
  }

  await channel.send({
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: 0x00ff00, components: [{ type: 10, content: 'Transcript saved!' }] }],
  });

  await channel.send({
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: 0xff0000, components: [{ type: 10, content: 'Deleting ticket...' }] }],
  });

  ticket.closedAt = Date.now();
  ticket.closedBy = interaction.user.id;
  ticket.closeAction = action;
  saveState(state);

  logCommandSystem(`[TicketSystem] Ticket ${ticket.ticketId} (${channel.id}) closed by ${interaction.user.id} with action ${action}.`);

  setTimeout(async () => {
    await channel.delete('Ticket closed').catch(() => null);
  }, 3000);

  return true;
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:type-select') {
    const selected = interaction.values[0];
    if (selected === 'guild_support') {
      await interaction.showModal(buildGuildSupportModal());
      return true;
    }

    if (selected === 'claim_reward') {
      await interaction.showModal(buildClaimRewardModal());
      return true;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket:modal:guild_support') {
    const selectedValue = getGuildSupportSelection(interaction);
    const answer = formatGuildSupportAnswer(selectedValue);

    if (!answer) {
      await interaction.reply({
        content: 'Please choose a support type before submitting the form.',
        flags: EPHEMERAL_FLAG,
      });
      return true;
    }

    return createTicketFromModal(
      interaction,
      TICKET_TYPES.guild_support,
      'What type of support do you need?',
      answer,
    );
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket:modal:claim_reward') {
    const answer = interaction.fields.getTextInputValue('roblox_username');
    return createTicketFromModal(
      interaction,
      TICKET_TYPES.claim_reward,
      'What is your Roblox username?',
      answer,
    );
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:actions') {
    const action = interaction.values[0];
    if (action === 'close' || action === 'blacklist') {
      return closeTicket(interaction, action);
    }
  }

  return false;
}

async function init(client) {
  if (initialized) {
    return;
  }

  initialized = true;
  ensureStoreFile();

  for (const guild of client.guilds.cache.values()) {
    await ensurePanelMessage(guild);
  }
}

async function forceRefreshPanel(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Administrator permission required.', flags: EPHEMERAL_FLAG });
    return;
  }

  const ok = await ensurePanelMessage(interaction.guild, true);
  await interaction.reply({
    content: ok ? 'Ticket panel refreshed.' : 'Ticket panel refresh failed.',
    flags: EPHEMERAL_FLAG,
  });
}

module.exports = {
  init,
  handleInteraction,
  forceRefreshPanel,
};
