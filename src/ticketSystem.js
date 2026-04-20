const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { logCommandSystem } = require('./commandLogger');

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
  role_request: {
    key: 'role_request',
    label: 'Request role: Crew Member+',
    channelLabel: 'Role Request',
    description: 'Submit a request to receive the role.',
    emoji: '⭐',
  },
};

const ROLE_REQUEST_ROLE_ID = '1495039173260873738';
const TRUSTED_EVIDENCE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const IMAGE_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const ALLOWED_EVIDENCE_EXTENSIONS = new Set([...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS]);
const ALLOWED_EVIDENCE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/x-m4v',
  'video/mpeg',
]);

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
  const thumbnail = guild.iconURL();
  const panelBody = [
    'Need help? Please open the correct ticket type below.',
    '⚠️ Please do not open joke, false, or duplicate tickets.',
    '📌 Please be patient after opening a ticket. Staff will respond as soon as possible.',
  ].join('\n');

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Support Ticket')
        .setDescription(panelBody)
        .setColor(0xffffff)
        .setThumbnail(thumbnail ?? null),
    ],
    components: [
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
              {
                label: TICKET_TYPES.role_request.label,
                description: TICKET_TYPES.role_request.description,
                value: TICKET_TYPES.role_request.key,
                emoji: { name: TICKET_TYPES.role_request.emoji },
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
  const optionSuffix = Date.now();
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
          custom_id: `support_kind_${optionSuffix}`,
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

function buildRoleRequestModal() {
  return {
    custom_id: 'ticket:modal:role_request',
    title: 'Crew Member+ role request',
    components: [
      {
        type: 10,
        content:
          'Besure to meet the requirement:\n' +
          '* Dmg: 1000%+\n' +
          '* CritC: 70%+\n' +
          '* CritD: 225%+\n' +
          '* Level: 16000\n' +
          '* ascension: 10',
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'role_request_roblox_username',
            style: 2,
            label: 'Roblox username',
            required: true,
            max_length: 200,
          },
        ],
      },
      {
        type: 18,
        label: 'File Upload',
        description: 'Upload screenshots/videos proving you meet the role requirements.',
        component: {
          type: 19,
          custom_id: 'role_request_proof',
          min_values: 0,
          max_values: 10,
          required: false,
        },
      },
    ],
  };
}

function getGuildSupportSelection(interaction) {
  const modalComponents = Array.isArray(interaction.components) ? interaction.components : [];

  for (const container of modalComponents) {
    const radio = container?.component;
    if (radio?.type === 21 && typeof radio.customId === 'string' && radio.customId.startsWith('support_kind_')) {
      return radio.value ?? null;
    }
  }

  const rawInteraction = interaction.toJSON?.() ?? null;
  const rawComponents = rawInteraction?.data?.components;
  if (Array.isArray(rawComponents)) {
    for (const container of rawComponents) {
      const radio = container?.component;
      if (radio?.type === 21 && typeof radio.custom_id === 'string' && radio.custom_id.startsWith('support_kind_')) {
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

function getRoleRequestSubmission(interaction) {
  const resolvedInteraction = interaction.toJSON?.() ?? null;
  const rawData = resolvedInteraction?.data ?? {};
  const rawComponents = Array.isArray(rawData.components) ? rawData.components : [];
  const interactionComponents = Array.isArray(interaction.components) ? interaction.components : [];
  const resolvedAttachments = rawData.resolved?.attachments ?? {};
  const interactionAttachments = interaction.attachments;
  const fileIds = new Set();
  const directFiles = [];
  const robloxUsername = interaction.fields?.getTextInputValue?.('role_request_roblox_username') ?? '';

  function addFileId(value) {
    if (typeof value === 'string' && value.trim()) {
      fileIds.add(value);
      return;
    }

    if (value && typeof value === 'object') {
      const hasFileData =
        typeof value.url === 'string'
        || typeof value.proxy_url === 'string'
        || typeof value.proxyURL === 'string';
      if (hasFileData) {
        directFiles.push(value);
      }

      if (typeof value.id === 'string' && value.id.trim()) {
        fileIds.add(value.id);
      }
    }
  }

  function addFileIds(values) {
    if (!values) {
      return;
    }

    const normalizedValues = Array.isArray(values)
      ? values
      : values instanceof Map
        ? Array.from(values.values())
        : typeof values.values === 'function'
          ? Array.from(values.values())
          : typeof values[Symbol.iterator] === 'function'
            ? Array.from(values)
            : [values];

    for (const value of normalizedValues) {
      addFileId(value);
    }
  }

  function collectFileIds(node) {
    if (!node || typeof node !== 'object') {
      return;
    }

    const componentType = node.type;
    const componentCustomId = node.customId ?? node.custom_id;

    if (componentType === 19 && componentCustomId === 'role_request_proof') {
      addFileIds(node.values);
      addFileIds(node.value);
      addFileIds(node.files);
      addFileIds(node.attachments);
    }

    if (Array.isArray(node.components)) {
      for (const child of node.components) {
        collectFileIds(child);
      }
    }

    if (node.component && typeof node.component === 'object') {
      collectFileIds(node.component);
    }
  }

  for (const components of [interactionComponents, rawComponents]) {
    for (const rootNode of components) {
      collectFileIds(rootNode);
    }
  }

  if (interaction.fields?.getUploadedFiles) {
    const uploadedFiles = interaction.fields.getUploadedFiles('role_request_proof');
    const hasUploadedFiles = Array.isArray(uploadedFiles)
      ? uploadedFiles.length > 0
      : Boolean(uploadedFiles?.size);

    if (hasUploadedFiles) {
      addFileIds(uploadedFiles);
    }
  }

  const filesFromIds = Array.from(fileIds)
    .map((id) => {
      const resolvedFile = resolvedAttachments[id];
      if (resolvedFile && typeof resolvedFile === 'object') {
        return resolvedFile;
      }

      return interactionAttachments?.get?.(id) ?? null;
    })
    .filter((value) => value && typeof value === 'object');

  const dedupedFiles = [];
  const seenFileKeys = new Set();
  for (const file of [...directFiles, ...filesFromIds]) {
    const fileKey = file?.id ?? file?.url ?? file?.proxy_url ?? file?.proxyURL ?? file?.filename ?? null;
    if (!fileKey || seenFileKeys.has(fileKey)) {
      continue;
    }
    seenFileKeys.add(fileKey);
    dedupedFiles.push(file);
  }

  if (!dedupedFiles.length && interactionAttachments?.size) {
    dedupedFiles.push(...Array.from(interactionAttachments.values()));
  }

  return {
    robloxUsername,
    files: dedupedFiles,
  };
}

function sanitizeInlineMarkdown(value) {
  return String(value ?? '').replace(/[[\]()]/g, '\\$&');
}

function isTrustedEvidenceUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === 'https:' && TRUSTED_EVIDENCE_HOSTS.has(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function getFileExtension(filename) {
  const value = String(filename ?? '').toLowerCase().trim();
  if (!value) {
    return '';
  }

  const extension = path.extname(value);
  return extension || '';
}

function getEvidenceFileType(file) {
  const mimeType = String(file?.contentType ?? file?.content_type ?? '').toLowerCase().trim();
  const extension = getFileExtension(file?.filename);
  return mimeType || extension || 'unknown';
}

function isAllowedEvidenceFile(file) {
  const mimeType = String(file?.contentType ?? file?.content_type ?? '').toLowerCase().trim();
  if (mimeType && ALLOWED_EVIDENCE_MIME_TYPES.has(mimeType)) {
    return true;
  }

  const extension = getFileExtension(file?.filename);
  return Boolean(extension) && ALLOWED_EVIDENCE_EXTENSIONS.has(extension);
}

function buildRoleRequestEvidence(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      evidenceText: '*No evidence files uploaded.*',
    };
  }

  const evidenceLines = [];
  let rejectedFilesCount = 0;

  for (const file of files) {
    const rawFilename = file?.filename ?? 'unknown-file';
    const fileType = getEvidenceFileType(file);
    if (!isAllowedEvidenceFile(file)) {
      rejectedFilesCount += 1;
      evidenceLines.push(`• ${sanitizeInlineMarkdown(rawFilename)} (type: ${sanitizeInlineMarkdown(fileType)}) — rejected (unsupported type)`);
      continue;
    }

    const safeFilename = sanitizeInlineMarkdown(rawFilename);
    const fileUrl = file?.url ?? file?.proxy_url ?? null;
    const trustedUrl = isTrustedEvidenceUrl(fileUrl) ? fileUrl : null;

    const linkedFile = trustedUrl
      ? `• [${safeFilename}](${trustedUrl}) (type: ${sanitizeInlineMarkdown(fileType)})`
      : `• ${safeFilename} (type: ${sanitizeInlineMarkdown(fileType)})`;
    evidenceLines.push(linkedFile);
  }

  if (!evidenceLines.length) {
    evidenceLines.push('*No evidence files uploaded.*');
  }

  if (rejectedFilesCount > 0) {
    evidenceLines.push(`\nUnsupported files rejected: ${rejectedFilesCount}.`);
  }

  return {
    evidenceText: evidenceLines.join('\n'),
  };
}

function buildRoleRequestReviewPayload(requesterId, robloxUsername, evidenceText, { accentColor, action, disableMenu }) {
  const placeholder = action ? `This request has been ${action}` : 'Select an action';
  const statusText = action ? `Status: **${action.toUpperCase()}**` : 'Status: **PENDING**';
  const sanitizedRobloxUsername = sanitizeInlineMarkdown(robloxUsername || 'Not provided');

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(accentColor)
        .setTitle("⭐ Crew Member+ role request")
        .setDescription(`Requester: <@${requesterId}> \`(${requesterId})\`\n${statusText}`)
        .addFields({ name: 'Roblox username', value: sanitizedRobloxUsername.slice(0, 1024) })
        .addFields({ name: 'Evidence', value: evidenceText.slice(0, 1024) || '*No evidence files uploaded.*' }),
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `ticket:role-review:${requesterId}`,
            placeholder,
            disabled: disableMenu,
            options: [
              { label: 'Accept', value: 'accept', emoji: { name: '✅' } },
              { label: 'Deny', value: 'deny', emoji: { name: '❌' } },
            ],
          },
        ],
      },
    ],
  };
}

function extractRoleRequestEvidenceText(embeds) {
  if (!Array.isArray(embeds) || !embeds.length) {
    return '*No evidence provided*';
  }

  const evidenceField = embeds
    .flatMap((embed) => (Array.isArray(embed?.fields) ? embed.fields : []))
    .find((field) => field?.name === 'Evidence' && typeof field.value === 'string');

  return evidenceField?.value ?? '*No evidence provided*';
}

function extractRoleRequestRobloxUsername(embeds) {
  if (!Array.isArray(embeds) || !embeds.length) {
    return 'Not provided';
  }

  const usernameField = embeds
    .flatMap((embed) => (Array.isArray(embed?.fields) ? embed.fields : []))
    .find((field) => field?.name === 'Roblox username' && typeof field.value === 'string');

  return usernameField?.value ?? 'Not provided';
}

function buildRoleRequestResultDM(status, reason = null) {
  const accepted = status === 'accepted';
  const reasonText = reason ? `\nReason: ${reason}` : '';
  const privateServerLine = accepted
    ? '\n-# Join our private server to enter the guild: https://www.roblox.com/share?code=15f940e07e326441b5aa511a0e5b608b&type=Server'
    : '';
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(accepted ? 0x00ff00 : 0xff0000)
        .setDescription(`Your ⭐Crew Member+ role request has been **${status.toUpperCase()}**.${reasonText}${privateServerLine}`),
    ],
  };
}


function canUseTicketActions(interaction) {
  const member = interaction.member;
  if (!member) {
    return false;
  }

  if (member.permissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return member.roles?.cache?.has(ADMIN_ROLE_ID) ?? false;
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
    content: `<@${userId}> Welcome!`,
    embeds: [
      {
        color: 0xffffff,
        description:
          `**${ticketType.label} Ticket**\n` +
          '* Our staff will be with you soon, please be patience and provide necessary information so the help will be faster!\n\n' +
          `${formQuestion}\n${formAnswer}`,
      },
    ],
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
      content: 'Blacklisted user from all ticket system.',
      flags: EPHEMERAL_FLAG,
    });
  } else {
    await interaction.reply({ content: 'Starting ticket close process...', flags: EPHEMERAL_FLAG });
  }

  await channel.send({
    embeds: [new EmbedBuilder().setColor(0xffff00).setDescription('Transcript saving!...')],
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
    embeds: [new EmbedBuilder().setColor(0x00ff00).setDescription('Transcript saved!')],
  });

  await channel.send({
    embeds: [new EmbedBuilder().setColor(0xff0000).setDescription('Deleting ticket...')],
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
    const panelPayload = buildPanelPayload(interaction.guild);
    await interaction.message?.edit(panelPayload).catch(() => null);

    const selected = interaction.values[0];
    if (selected === 'guild_support') {
      await interaction.showModal(buildGuildSupportModal());
      return true;
    }

    if (selected === 'claim_reward') {
      await interaction.showModal(buildClaimRewardModal());
      return true;
    }

    if (selected === 'role_request') {
      await interaction.showModal(buildRoleRequestModal());
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

  if (interaction.isModalSubmit() && interaction.customId === 'ticket:modal:role_request') {
    const submission = getRoleRequestSubmission(interaction);

    const logChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
    if (!logChannel?.isTextBased()) {
      await interaction.reply({
        content: 'Role request log channel is unavailable. Please contact staff.',
        flags: EPHEMERAL_FLAG,
      });
      return true;
    }

    const { evidenceText } = buildRoleRequestEvidence(submission.files);

    await logChannel.send(
      buildRoleRequestReviewPayload(interaction.user.id, submission.robloxUsername, evidenceText, {
        accentColor: 0xffffff,
        action: null,
        disableMenu: false,
      }),
    );

    await interaction.reply({
      content: 'Your ⭐Crew Member+ role request has been submitted for review.',
      flags: EPHEMERAL_FLAG,
    });

    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket:role-review:')) {
    if (!canUseTicketActions(interaction)) {
      await interaction.reply({
        content: 'Only administrators or members with the admin role can review role requests.',
        flags: EPHEMERAL_FLAG,
      });
      return true;
    }

    const requesterId = interaction.customId.split(':')[2];
    const action = interaction.values[0];
    const currentRobloxUsername = extractRoleRequestRobloxUsername(interaction.message.embeds ?? []);
    const currentEvidenceText = extractRoleRequestEvidenceText(interaction.message.embeds ?? []);

    if (action === 'accept') {
      const role = await interaction.guild.roles.fetch(ROLE_REQUEST_ROLE_ID).catch(() => null);
      if (!role) {
        await interaction.reply({
          content: `Unable to assign role: role \`${ROLE_REQUEST_ROLE_ID}\` was not found. Please check the role configuration.`,
          flags: EPHEMERAL_FLAG,
        });
        return true;
      }

      const member = await interaction.guild.members.fetch(requesterId).catch(() => null);
      if (!member) {
        await interaction.reply({
          content: 'Unable to assign role: requester is no longer in the server.',
          flags: EPHEMERAL_FLAG,
        });
        return true;
      }

      const roleAddError = await member.roles
        .add(role.id, `Role request accepted by ${interaction.user.tag}`)
        .then(() => null)
        .catch((error) => error);

      if (roleAddError) {
        logCommandSystem(
          `Failed to assign Crew Member+ role (${role.id}) to ${requesterId}: ${roleAddError.message || roleAddError}`,
          'Ticket System',
        );
        await interaction.reply({
          content: 'Unable to assign the Crew Member+ role. Please verify role hierarchy and bot permissions, then try again.',
          flags: EPHEMERAL_FLAG,
        });
        return true;
      }

      await interaction.update(
        buildRoleRequestReviewPayload(requesterId, currentRobloxUsername, currentEvidenceText, {
          accentColor: 0x00ff00,
          action: 'accepted',
          disableMenu: true,
        }),
      );

      const user = await interaction.client.users.fetch(requesterId).catch(() => null);
      await user?.send(buildRoleRequestResultDM('accepted')).catch(() => null);
      return true;
    }

    if (action === 'deny') {
      await interaction.showModal({
        custom_id: `ticket:modal:role_request_deny:${requesterId}:${interaction.message.id}`,
        title: 'Deny Crew Member+ request',
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: 'deny_reason',
                style: 2,
                label: 'Reason?',
                required: true,
                max_length: 500,
              },
            ],
          },
        ],
      });
      return true;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:modal:role_request_deny:')) {
    if (!canUseTicketActions(interaction)) {
      await interaction.reply({
        content: 'Only administrators or members with the admin role can review role requests.',
        flags: EPHEMERAL_FLAG,
      });
      return true;
    }

    const [, , , requesterId, messageId] = interaction.customId.split(':');
    const reason = interaction.fields.getTextInputValue('deny_reason').trim();
    const logChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
    const logMessage = logChannel?.isTextBased()
      ? await logChannel.messages.fetch(messageId).catch(() => null)
      : null;
    const currentRobloxUsername = extractRoleRequestRobloxUsername(logMessage?.embeds ?? []);
    const currentEvidenceText = extractRoleRequestEvidenceText(logMessage?.embeds ?? []);

    if (logMessage) {
      await logMessage.edit(
        buildRoleRequestReviewPayload(requesterId, currentRobloxUsername, currentEvidenceText, {
          accentColor: 0xff0000,
          action: 'denied',
          disableMenu: true,
        }),
      );
    }

    const user = await interaction.client.users.fetch(requesterId).catch(() => null);
    await user?.send(buildRoleRequestResultDM('denied', reason)).catch(() => null);

    await interaction.reply({
      content: 'Request denied and user notified.',
      flags: EPHEMERAL_FLAG,
    });

    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:actions') {
    if (!canUseTicketActions(interaction)) {
      await interaction.reply({
        content: 'Only administrators or members with the admin role can use ticket actions.',
        flags: EPHEMERAL_FLAG,
      });
      return true;
    }

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
