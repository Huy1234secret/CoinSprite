const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { logCommandSystem } = require('./commandLogger');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

const PANEL_CHANNEL_ID = '1493971939545583836';
const TICKET_CATEGORY_ID = '1493971752680947802';
const TRANSCRIPT_CHANNEL_ID = '1493974187285418157';
const ADMIN_ROLE_ID = '1494993523064443065';
const ROLE_REQUEST_ROLE_ID = '1495039173260873738';
const PANEL_HEALTHCHECK_INTERVAL_MS = 60_000;

const STORE_PATH = path.join(__dirname, '..', 'data', 'ticket-state.json');
const TRANSCRIPT_DIR = path.join(__dirname, '..', 'transcripts');

const TICKET_TYPES = {
  guild_support: {
    key: 'guild_support',
    label: 'Guild Support',
    channelLabel: 'Guild Support',
    description: 'Use this ticket for guild help, member issues, questions, or other guild-related support.',
    emoji: '🛡️',
    createsChannel: true,
  },
  claim_reward: {
    key: 'claim_reward',
    label: 'Claim Reward',
    channelLabel: 'Claim Reward',
    description: 'Use this ticket if you want to claim a reward. Please provide proof or details when needed.',
    emoji: '🎁',
    createsChannel: true,
  },
  role_request: {
    key: 'role_request',
    label: 'Request role: Crew Member+',
    channelLabel: null,
    description: 'Submit a request to receive the role.',
    emoji: '⭐',
    createsChannel: false,
  },
};

const IMAGE_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.avif',
  '.svg',
]);
const VIDEO_FILE_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.wmv',
  '.flv',
  '.3gp',
]);
const TRUSTED_EVIDENCE_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

let initialized = false;
let panelHealthcheckTimer = null;
const panelEnsureInFlight = new Map();

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
          roleRequests: {},
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
      throw new Error('Invalid ticket state.');
    }

    parsed.panelMessageId = typeof parsed.panelMessageId === 'string' ? parsed.panelMessageId : null;
    parsed.nextTicketNumber = Number.isInteger(parsed.nextTicketNumber) ? parsed.nextTicketNumber : 0;
    parsed.blacklistedUsers = parsed.blacklistedUsers && typeof parsed.blacklistedUsers === 'object' ? parsed.blacklistedUsers : {};
    parsed.tickets = parsed.tickets && typeof parsed.tickets === 'object' ? parsed.tickets : {};
    parsed.roleRequests = parsed.roleRequests && typeof parsed.roleRequests === 'object' ? parsed.roleRequests : {};
    parsed.updatedAt = parsed.updatedAt ?? Date.now();
    return parsed;
  } catch {
    return {
      panelMessageId: null,
      nextTicketNumber: 0,
      blacklistedUsers: {},
      tickets: {},
      roleRequests: {},
      updatedAt: Date.now(),
    };
  }
}

function saveState(state) {
  ensureStoreFile();
  state.updatedAt = Date.now();
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function padTwo(value) {
  return String(value).padStart(2, '0');
}

function padTicketNumber(value) {
  return String(value).padStart(4, '0');
}

function sanitizeInlineMarkdown(value) {
  return String(value ?? '').replace(/[[\]()]/g, '\\$&');
}

function truncateText(value, maxLength = 3900) {
  const normalized = String(value ?? '');
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatTicketChannelName(channelLabel, ticketId) {
  const safeBase = String(channelLabel ?? 'ticket')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${safeBase}-${ticketId}`;
}

function getDateStamp(now = new Date()) {
  const month = padTwo(now.getMonth() + 1);
  const day = padTwo(now.getDate());
  const year = now.getFullYear();
  const minutes = padTwo(now.getMinutes());
  const hours = padTwo(now.getHours());

  return {
    display: `${month}/${day}/${year} ${minutes}:${hours}`,
    fileSafe: `${month}-${day}-${year}_${minutes}-${hours}`,
  };
}

function buildStatusPayload(accentColor, message) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [
          {
            type: 10,
            content: message,
          },
        ],
      },
    ],
  };
}

function buildPanelOptions() {
  return Object.values(TICKET_TYPES).map((ticketType) => ({
    label: ticketType.label,
    description: ticketType.description,
    value: ticketType.key,
    emoji: { name: ticketType.emoji },
  }));
}

function buildPanelPayload(guild) {
  const thumbnailUrl = guild.iconURL?.() ?? null;
  const components = [
    {
      type: 10,
      content: '## Support Ticket',
    },
  ];

  if (thumbnailUrl) {
    components.push({
      type: 11,
      media: {
        url: thumbnailUrl,
      },
    });
  }

  components.push(
    {
      type: 10,
      content: 'Need help? Please open the correct ticket type below.',
    },
    {
      type: 14,
      divider: true,
      spacing: 1,
    },
    {
      type: 10,
      content: '-# ⚠️ Please do not open joke, false, or duplicate tickets.\n-# 📌 Please be patient after opening a ticket. Staff will respond as soon as possible.',
    },
    {
      type: 14,
      divider: true,
      spacing: 1,
    },
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: 'ticket:type-select',
          placeholder: 'Choose a ticket type',
          options: buildPanelOptions(),
        },
      ],
    },
  );

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components,
      },
    ],
  };
}

function buildTicketActionSelect(disabled = false) {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: 'ticket:actions',
        placeholder: 'Ticket Actions',
        disabled,
        options: [
          {
            label: 'Close Ticket',
            value: 'close',
            emoji: { name: '⛔' },
          },
          {
            label: 'Blacklist User',
            value: 'blacklist',
            emoji: { name: '💀' },
          },
        ],
      },
    ],
  };
}

function buildTicketCreatedPayload(userId, ticketType, formQuestion, formAnswer) {
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: {
      users: [userId],
    },
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `<@${userId}> Welcome!\n## ${ticketType.label}'s ticket\n* Our staff will be with you soon, please be patience and provide necessary information so the help will be faster!`,
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          {
            type: 10,
            content: `${formQuestion}\n${String(formAnswer ?? '').trim() || 'No answer provided.'}`,
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          buildTicketActionSelect(false),
        ],
      },
    ],
  };
}

function buildRoleRequestReviewPayload(roleRequest, action = null) {
  const status = action ?? roleRequest.status ?? 'pending';
  const statusColor = status === 'accepted' ? 0x00ff00 : status === 'denied' ? 0xff0000 : 0xffffff;
  const placeholder = status === 'pending' ? 'Select an action' : `This request has been ${status}`;
  const disabled = status !== 'pending';
  const usernameText = sanitizeInlineMarkdown(roleRequest.robloxUsername || 'Not provided');
  const reasonLine = status === 'denied' && roleRequest.deniedReason
    ? `\n-# Reason: ${sanitizeInlineMarkdown(roleRequest.deniedReason)}`
    : '';

  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: {
      users: [],
    },
    components: [
      {
        type: 17,
        accent_color: statusColor,
        components: [
          {
            type: 10,
            content: `### <@${roleRequest.requesterId}>'s ⭐Crew Member+ role request.\n* userID: ${roleRequest.requesterId}\n* Roblox username: ${usernameText}\n* Status: ${status.toUpperCase()}${reasonLine}`,
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          {
            type: 10,
            content: truncateText(roleRequest.evidenceText || '*No evidence uploaded.*'),
          },
          {
            type: 14,
            divider: true,
            spacing: 1,
          },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `ticket:role-review:${roleRequest.requesterId}`,
                placeholder,
                disabled,
                options: [
                  {
                    label: 'Accept',
                    value: 'accept',
                    emoji: { name: '✅' },
                  },
                  {
                    label: 'Deny',
                    value: 'deny',
                    emoji: { name: '❌' },
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

function buildGuildSupportModal() {
  const optionSuffix = Date.now();
  return {
    custom_id: 'ticket:modal:guild_support',
    title: 'Guild Support Form',
    components: [
      {
        type: 18,
        label: 'What type of support do you need?',
        description: 'Select the support type that best matches your issue.',
        component: {
          type: 21,
          custom_id: `support_kind_${optionSuffix}`,
          required: true,
          options: [
            {
              value: 'report_member',
              label: 'Report a Member',
              description: 'Report a guild member or their behavior.',
            },
            {
              value: 'other_support',
              label: 'Other support',
              description: 'Use this for any other guild support request.',
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
            style: 1,
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
        content: 'Besure to meet the requirement:\n* Dmg: 1000%+\n* CritC: 70%+\n* CritD: 250%+\n* Level: 16000\n* ascension: 10',
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'role_request_roblox_username',
            style: 1,
            label: 'What is your Roblox username?',
            required: true,
            max_length: 200,
          },
        ],
      },
      {
        type: 18,
        label: 'Provide evidence proven that you\'ve met the role requirement.',
        description: 'Upload image or video evidence only.',
        component: {
          type: 19,
          custom_id: 'role_request_proof',
          min_values: 1,
          max_values: 10,
          required: true,
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
    return 'Report a Member';
  }

  if (value === 'other_support') {
    return 'Other support';
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
      const hasFileData = typeof value.url === 'string' || typeof value.proxy_url === 'string' || typeof value.proxyURL === 'string';
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
      collectFileIds([node.component]);
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
    .filter((file) => file && typeof file === 'object');

  const dedupedFiles = [];
  const seenKeys = new Set();
  for (const file of [...directFiles, ...filesFromIds]) {
    const key = file?.id ?? file?.url ?? file?.proxy_url ?? file?.proxyURL ?? file?.filename ?? null;
    if (!key || seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    dedupedFiles.push(file);
  }

  if (!dedupedFiles.length && interactionAttachments?.size) {
    for (const attachment of interactionAttachments.values()) {
      const key = attachment?.id ?? attachment?.url ?? attachment?.filename ?? null;
      if (!key || seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      dedupedFiles.push(attachment);
    }
  }

  return {
    robloxUsername,
    files: dedupedFiles,
  };
}

function getFileExtension(filename) {
  const normalized = String(filename ?? '').trim().toLowerCase();
  return normalized ? path.extname(normalized) : '';
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

function isAllowedEvidenceFile(file) {
  const mimeType = String(file?.contentType ?? file?.content_type ?? '').toLowerCase().trim();
  if (mimeType) {
    return mimeType.startsWith('image/') || mimeType.startsWith('video/');
  }

  const extension = getFileExtension(file?.filename);
  return IMAGE_FILE_EXTENSIONS.has(extension) || VIDEO_FILE_EXTENSIONS.has(extension);
}

function buildRoleRequestEvidence(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      ok: false,
      error: 'Please upload at least one image or video as evidence.',
    };
  }

  const invalidFile = files.find((file) => !isAllowedEvidenceFile(file));
  if (invalidFile) {
    return {
      ok: false,
      error: 'Please upload only image or video files for the Crew Member+ request.',
    };
  }

  const evidenceLines = files.map((file) => {
    const fileName = sanitizeInlineMarkdown(file?.filename ?? 'evidence-file');
    const fileUrl = file?.url ?? file?.proxy_url ?? file?.proxyURL ?? null;
    if (isTrustedEvidenceUrl(fileUrl)) {
      return `• [${fileName}](${fileUrl})`;
    }

    return `• ${fileName}`;
  });

  return {
    ok: true,
    evidenceText: evidenceLines.join('\n'),
  };
}

function componentTreeHasCustomId(components, customId) {
  if (!Array.isArray(components)) {
    return false;
  }

  for (const component of components) {
    if (!component || typeof component !== 'object') {
      continue;
    }

    if ((component.customId ?? component.custom_id) === customId) {
      return true;
    }

    if (componentTreeHasCustomId(component.components, customId)) {
      return true;
    }

    if (component.component && componentTreeHasCustomId([component.component], customId)) {
      return true;
    }
  }

  return false;
}

function extractTextDisplayContent(components, parts = []) {
  if (!Array.isArray(components)) {
    return parts;
  }

  for (const component of components) {
    if (!component || typeof component !== 'object') {
      continue;
    }

    if (component.type === 10 && typeof component.content === 'string' && component.content.trim()) {
      parts.push(component.content.trim());
    }

    if (Array.isArray(component.components)) {
      extractTextDisplayContent(component.components, parts);
    }

    if (component.component && typeof component.component === 'object') {
      extractTextDisplayContent([component.component], parts);
    }
  }

  return parts;
}

function getTranscriptBody(message) {
  const parts = [];
  if (typeof message.content === 'string' && message.content.trim()) {
    parts.push(message.content.trim());
  }

  const componentText = extractTextDisplayContent(message.components ?? []).join(' | ');
  if (componentText) {
    parts.push(componentText);
  }

  const attachments = message.attachments?.size
    ? Array.from(message.attachments.values())
      .map((attachment) => attachment?.url ? `${attachment.filename} (${attachment.url})` : attachment.filename)
      .filter(Boolean)
    : [];
  if (attachments.length) {
    parts.push(`Attachments: ${attachments.join(', ')}`);
  }

  return parts.join(' | ') || '[No text content]';
}

function formatTranscriptLine(date, username, userId, messageText) {
  const normalizedDate = date instanceof Date ? date : new Date(date ?? Date.now());
  const minutes = padTwo(normalizedDate.getMinutes());
  const hours = padTwo(normalizedDate.getHours());
  return `${minutes}:${hours} // ${username} - ${userId}: ${messageText}`;
}

function formatMessageTranscriptLine(message) {
  const createdAt = message.createdAt ?? new Date(message.createdTimestamp ?? Date.now());
  const username = message.author?.username ?? 'UnknownUser';
  const userId = message.author?.id ?? 'unknown';
  const body = getTranscriptBody(message).replace(/\r?\n/g, ' | ');
  return formatTranscriptLine(createdAt, username, userId, body);
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
  const inFlightKey = `${guild.id}:${force ? 'force' : 'normal'}`;
  if (panelEnsureInFlight.has(inFlightKey)) {
    return panelEnsureInFlight.get(inFlightKey);
  }

  const run = (async () => {
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
        const editError = await panelMessage.edit(payload).then(() => null).catch((error) => error);
        if (editError) {
          logCommandSystem(`[TicketSystem] Failed to update stored panel message ${panelMessage.id}: ${editError.message || editError}`);
          panelMessage = null;
        }
      }
    }

    if (!panelMessage) {
      const recentMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      panelMessage = recentMessages?.find((message) => {
        return message.author?.id === guild.client.user.id && componentTreeHasCustomId(message.components, 'ticket:type-select');
      }) ?? null;

      if (panelMessage) {
        const editError = await panelMessage.edit(payload).then(() => null).catch((error) => error);
        if (editError) {
          logCommandSystem(`[TicketSystem] Failed to refresh discovered panel message ${panelMessage.id}: ${editError.message || editError}`);
          panelMessage = null;
        }
      }
    }

    if (!panelMessage) {
      const sendError = await channel.send(payload).then((message) => {
        panelMessage = message;
        return null;
      }).catch((error) => error);

      if (sendError) {
        logCommandSystem(`[TicketSystem] Failed to send panel message: ${sendError.message || sendError}`);
        return false;
      }
    }

    state.panelMessageId = panelMessage.id;
    saveState(state);
    logCommandSystem(`[TicketSystem] Panel message ensured in channel ${PANEL_CHANNEL_ID} (${panelMessage.id}).`);
    return true;
  })();

  panelEnsureInFlight.set(inFlightKey, run);
  try {
    return await run;
  } finally {
    panelEnsureInFlight.delete(inFlightKey);
  }
}

async function ensurePanelForGuildById(client, guildId, force = false) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return false;
  }

  return ensurePanelMessage(guild, force);
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

  const ticketId = padTicketNumber(state.nextTicketNumber);
  state.nextTicketNumber += 1;

  const guild = interaction.guild;
  const channelName = formatTicketChannelName(ticketType.channelLabel, ticketId);
  const channel = await guild.channels.create({
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
  }).catch((error) => {
    logCommandSystem(`[TicketSystem] Failed to create ticket channel for ${userId}: ${error?.message ?? error}`);
    return null;
  });

  if (!channel) {
    await interaction.reply({
      content: 'Failed to create the ticket channel. Please contact staff.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  state.tickets[channel.id] = {
    ownerId: userId,
    ticketId,
    ticketType: ticketType.key,
    ticketTypeLabel: ticketType.label,
    formQuestion,
    formAnswer,
    createdAt: Date.now(),
    closedAt: null,
    closedBy: null,
    closeAction: null,
  };
  saveState(state);

  const sendError = await channel.send(buildTicketCreatedPayload(userId, ticketType, formQuestion, formAnswer))
    .then(() => null)
    .catch((error) => error);
  if (sendError) {
    logCommandSystem(`[TicketSystem] Failed to send ticket template in ${channel.id}: ${sendError.message || sendError}`);
  }

  await interaction.reply({
    content: `Ticket created: ${channel}`,
    flags: EPHEMERAL_FLAG,
  });

  logCommandSystem(`[TicketSystem] Created ${ticketType.label} ticket ${ticketId} in channel ${channel.id} for user ${userId}.`);
  return true;
}

async function submitRoleRequest(interaction) {
  const state = loadState();
  if (state.blacklistedUsers[interaction.user.id]?.active) {
    await interaction.reply({
      content: 'You are blacklisted from the ticket system.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  const submission = getRoleRequestSubmission(interaction);
  const evidence = buildRoleRequestEvidence(submission.files);
  if (!evidence.ok) {
    await interaction.reply({
      content: evidence.error,
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  const logChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (!logChannel?.isTextBased()) {
    await interaction.reply({
      content: 'Role request log channel is unavailable. Please contact staff.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  const roleRequest = {
    requesterId: interaction.user.id,
    robloxUsername: submission.robloxUsername.trim(),
    evidenceText: evidence.evidenceText,
    status: 'pending',
    deniedReason: '',
    submittedAt: Date.now(),
    reviewedAt: null,
    reviewedBy: null,
  };

  const reviewMessage = await logChannel.send(buildRoleRequestReviewPayload(roleRequest))
    .catch((error) => {
      logCommandSystem(`[TicketSystem] Failed to log role request for ${interaction.user.id}: ${error?.message ?? error}`);
      return null;
    });

  if (!reviewMessage) {
    await interaction.reply({
      content: 'Failed to submit your role request. Please contact staff.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  state.roleRequests[reviewMessage.id] = roleRequest;
  saveState(state);

  await interaction.reply({
    content: 'Your ⭐Crew Member+ role request has been submitted for review.',
    flags: EPHEMERAL_FLAG,
  });

  return true;
}

async function disableOwnerSendPermission(channel, ownerId) {
  await channel.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch((error) => {
    logCommandSystem(`[TicketSystem] Failed to disable SendMessages for ${ownerId} in ${channel.id}: ${error?.message ?? error}`);
  });
}

async function collectTranscript(channel, extraLines = []) {
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
  return [...messages.map(formatMessageTranscriptLine), ...extraLines];
}

async function closeTicket(interaction, action) {
  const state = loadState();
  const ticket = state.tickets[interaction.channelId];
  if (!ticket) {
    await interaction.reply({
      content: 'This channel is not registered as a ticket.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  const channel = interaction.channel;
  if (!channel?.isTextBased()) {
    await interaction.reply({
      content: 'Ticket channel unavailable.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  if (!canUseTicketActions(interaction)) {
    await interaction.reply({
      content: 'Only administrators or members with the admin role can use ticket actions.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  await interaction.deferUpdate();
  await disableOwnerSendPermission(channel, ticket.ownerId);

  if (action === 'blacklist') {
    state.blacklistedUsers[ticket.ownerId] = {
      active: true,
      reason: `Blacklisted via ticket ${ticket.ticketId} by ${interaction.user.id}`,
      updatedAt: Date.now(),
    };
    saveState(state);

    await channel.send(buildStatusPayload(0x000000, 'Blacklisted user from all ticket system.')).catch(() => null);
  }

  await channel.send(buildStatusPayload(0xffff00, 'Transcript saving!...')).catch(() => null);

  const syntheticLines = [
    formatTranscriptLine(new Date(), interaction.user.username, interaction.user.id, `Selected Ticket Action: ${action}`),
    formatTranscriptLine(new Date(), interaction.client.user.username, interaction.client.user.id, 'Transcript saved!'),
    formatTranscriptLine(new Date(), interaction.client.user.username, interaction.client.user.id, 'Deleting ticket...'),
  ];
  const transcriptLines = await collectTranscript(channel, syntheticLines);

  if (!fs.existsSync(TRANSCRIPT_DIR)) {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  }

  const stamp = getDateStamp(new Date());
  const fileName = `${ticket.ticketTypeLabel} - ${stamp.fileSafe}.txt`;
  const filePath = path.join(TRANSCRIPT_DIR, fileName);
  fs.writeFileSync(filePath, transcriptLines.join('\n'), 'utf8');

  const transcriptChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (transcriptChannel?.isTextBased()) {
    await transcriptChannel.send({
      content:
        `Transcript saved for **${ticket.ticketTypeLabel}** (#${ticket.ticketId}).\n` +
        `Closed by: <@${interaction.user.id}>\nOwner: <@${ticket.ownerId}>\nTimestamp: ${stamp.display}`,
      files: [{ attachment: filePath, name: fileName }],
    }).catch((error) => {
      logCommandSystem(`[TicketSystem] Failed to send transcript for ${channel.id}: ${error?.message ?? error}`);
    });
  }

  await channel.send(buildStatusPayload(0x00ff00, 'Transcript saved!')).catch(() => null);
  await channel.send(buildStatusPayload(0xff0000, 'Deleting ticket...')).catch(() => null);

  ticket.closedAt = Date.now();
  ticket.closedBy = interaction.user.id;
  ticket.closeAction = action;
  saveState(state);

  logCommandSystem(`[TicketSystem] Ticket ${ticket.ticketId} (${channel.id}) closed by ${interaction.user.id} with action ${action}.`);

  setTimeout(async () => {
    await channel.delete('Ticket closed').catch((error) => {
      logCommandSystem(`[TicketSystem] Failed to delete ticket channel ${channel.id}: ${error?.message ?? error}`);
    });
  }, 3000);

  return true;
}

async function handleRoleRequestAction(interaction) {
  if (!canUseTicketActions(interaction)) {
    await interaction.reply({
      content: 'Only administrators or members with the admin role can review role requests.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  const requesterId = interaction.customId.split(':')[2];
  const action = interaction.values[0];
  const state = loadState();
  const roleRequest = state.roleRequests[interaction.message.id];
  if (!roleRequest || roleRequest.requesterId !== requesterId) {
    await interaction.reply({
      content: 'Role request data could not be found.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  if (roleRequest.status !== 'pending') {
    await interaction.reply({
      content: 'This role request has already been processed.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  if (action === 'accept') {
    const role = await interaction.guild.roles.fetch(ROLE_REQUEST_ROLE_ID).catch(() => null);
    if (!role) {
      await interaction.reply({
        content: `Unable to assign role: role \`${ROLE_REQUEST_ROLE_ID}\` was not found.`,
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

    const roleAddError = await member.roles.add(role.id, `Crew Member+ role request accepted by ${interaction.user.tag}`)
      .then(() => null)
      .catch((error) => error);
    if (roleAddError) {
      logCommandSystem(`[TicketSystem] Failed to assign role ${role.id} to ${requesterId}: ${roleAddError.message || roleAddError}`);
      await interaction.reply({
        content: 'Unable to assign the Crew Member+ role. Please verify role hierarchy and bot permissions, then try again.',
        flags: EPHEMERAL_FLAG,
      });
      return true;
    }

    roleRequest.status = 'accepted';
    roleRequest.reviewedAt = Date.now();
    roleRequest.reviewedBy = interaction.user.id;
    saveState(state);

    await interaction.update(buildRoleRequestReviewPayload(roleRequest, 'accepted'));

    const user = await interaction.client.users.fetch(requesterId).catch(() => null);
    await user?.send(buildStatusPayload(0x00ff00, 'You ⭐Crew Member+ role request has been accepted!.')).catch(() => null);
    return true;
  }

  if (action === 'deny') {
    await interaction.showModal({
      custom_id: `ticket:modal:role-request-deny:${requesterId}:${interaction.message.id}`,
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

  return false;
}

async function handleRoleRequestDenyModal(interaction) {
  if (!canUseTicketActions(interaction)) {
    await interaction.reply({
      content: 'Only administrators or members with the admin role can review role requests.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  const parts = interaction.customId.split(':');
  const requesterId = parts[3];
  const messageId = parts[4];
  const reason = interaction.fields.getTextInputValue('deny_reason').trim();
  const state = loadState();
  const roleRequest = state.roleRequests[messageId];
  if (!roleRequest || roleRequest.requesterId !== requesterId) {
    await interaction.reply({
      content: 'Role request data could not be found.',
      flags: EPHEMERAL_FLAG,
    });
    return true;
  }

  roleRequest.status = 'denied';
  roleRequest.deniedReason = reason;
  roleRequest.reviewedAt = Date.now();
  roleRequest.reviewedBy = interaction.user.id;
  saveState(state);

  const logChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  const reviewMessage = logChannel?.isTextBased()
    ? await logChannel.messages.fetch(messageId).catch(() => null)
    : null;
  if (reviewMessage) {
    await reviewMessage.edit(buildRoleRequestReviewPayload(roleRequest, 'denied')).catch((error) => {
      logCommandSystem(`[TicketSystem] Failed to update denied role request ${messageId}: ${error?.message ?? error}`);
    });
  }

  const user = await interaction.client.users.fetch(requesterId).catch(() => null);
  await user?.send(buildStatusPayload(0xff0000, `You ⭐Crew Member+ role request has been denied!.\n-# Reason: ${reason}`)).catch(() => null);

  await interaction.reply({
    content: 'Request denied and user notified.',
    flags: EPHEMERAL_FLAG,
  });
  return true;
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:type-select') {
    const selected = interaction.values[0];
    if (selected === TICKET_TYPES.guild_support.key) {
      await interaction.showModal(buildGuildSupportModal());
      return true;
    }

    if (selected === TICKET_TYPES.claim_reward.key) {
      await interaction.showModal(buildClaimRewardModal());
      return true;
    }

    if (selected === TICKET_TYPES.role_request.key) {
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
    const answer = interaction.fields.getTextInputValue('roblox_username').trim();
    return createTicketFromModal(
      interaction,
      TICKET_TYPES.claim_reward,
      'What is your Roblox username?',
      answer,
    );
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket:modal:role_request') {
    return submitRoleRequest(interaction);
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket:role-review:')) {
    return handleRoleRequestAction(interaction);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:modal:role-request-deny:')) {
    return handleRoleRequestDenyModal(interaction);
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

  panelHealthcheckTimer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await ensurePanelMessage(guild);
    }
  }, PANEL_HEALTHCHECK_INTERVAL_MS);
}

async function forceRefreshPanel(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: 'Administrator permission required.',
      flags: EPHEMERAL_FLAG,
    });
    return;
  }

  const ok = await ensurePanelMessage(interaction.guild, true);
  await interaction.reply({
    content: ok ? 'Ticket panel refreshed.' : 'Ticket panel refresh failed.',
    flags: EPHEMERAL_FLAG,
  });
}

async function handleMessageDelete(message) {
  if (!message || message.channelId !== PANEL_CHANNEL_ID) {
    return false;
  }

  const state = loadState();
  const wasStoredPanel = state.panelMessageId === message.id;
  const lookedLikePanel = componentTreeHasCustomId(message.components ?? [], 'ticket:type-select');
  if (!wasStoredPanel && !lookedLikePanel) {
    return false;
  }

  state.panelMessageId = null;
  saveState(state);

  const ensured = await ensurePanelForGuildById(message.client, message.guildId, false);
  if (ensured) {
    logCommandSystem(`[TicketSystem] Panel message was deleted (${message.id}) and has been re-sent.`);
  } else {
    logCommandSystem(`[TicketSystem] Panel message was deleted (${message.id}) but resend failed.`);
  }

  return ensured;
}

module.exports = {
  init,
  handleInteraction,
  forceRefreshPanel,
  handleMessageDelete,
};
