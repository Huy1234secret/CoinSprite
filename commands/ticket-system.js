const fs = require('fs');
const { appendTranscriptSection } = require('../src/monthlyTranscriptArchive');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { loadState, saveState } = require('../src/ticketSystemStore');

const TICKET_PANEL_CHANNEL_ID = '1493971939545583836';
const TICKET_CATEGORY_ID = '1493971752680947802';
const ROLE_REQUEST_REVIEW_CHANNEL_ID = '1495714584437329940';
const GIVEAWAY_REQUEST_REVIEW_CHANNEL_ID = '1498546607686291558';
const TRANSCRIPT_CHANNEL_ID = '1495788766600757418';
const STAFF_ROLE_ID = '1494993523064443065';
const CREW_MEMBER_PLUS_ROLE_ID = '1495039173260873738';
const UTDX_CREW_MEMBER_PLUS_ROLE_ID = '1507984807680938165';
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

const CUSTOM_IDS = {
  panelTypeSelect: 'ticket:type-select',
  guildSupportModal: 'ticket:guild-support-modal',
  guildSupportRadio: 'guild_support_type',
  ticketActionSelectPrefix: 'ticket:actions:',
  roleReviewSelectPrefix: 'ticket:role-review:',
  denyReasonPrefix: 'ticket:deny-reason:',
  crewRoleRequestModal: 'ticket:crew-role-request-modal',
  crewRoleGame: 'crew_role_game',
  crewRoleUsername: 'roblox_username',
  crewRoleEvidenceUpload: 'role_requirement_evidence_upload',
  giveawayCoreDetails: 'giveaway_core_details',
  giveawayWinnerCount: 'giveaway_winner_count',
  giveawayDuration: 'giveaway_duration',
  giveawayClaimTime: 'giveaway_claim_time',
  giveawayRequirement: 'giveaway_requirement',
  giveawayPrize: 'giveaway_prize',
  giveawayEvidenceUpload: 'giveaway_evidence_upload',
  giveawayReviewSelectPrefix: 'ticket:giveaway-review:',
  giveawayDenyReasonPrefix: 'ticket:giveaway-deny-reason:',
  giveawayConfirmClaimPrefix: 'ticket:giveaway-confirm-claim:',
  giveawayClaimEvidenceModalPrefix: 'ticket:giveaway-claim-evidence:',
  giveawayClaimEvidenceUpload: 'giveaway_claim_evidence_upload',
};

function getCrewMemberPlusRoleIdForGame(game) {
  const normalizedGame = String(game || '').trim().toLowerCase();
  return normalizedGame === 'universe tower defense x' || normalizedGame === 'utdx'
    ? UTDX_CREW_MEMBER_PLUS_ROLE_ID
    : CREW_MEMBER_PLUS_ROLE_ID;
}

function getTicketPanelPayload() {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          { type: 10, content: '## Support Ticket' },
          { type: 10, content: 'Need help? Please open the correct ticket type below.' },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content:
              '-# ⚠️ Please do not open joke, false, or duplicate tickets.\n-# 📌 Please be patient after opening a ticket. Staff will respond as soon as possible.',
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: CUSTOM_IDS.panelTypeSelect,
                placeholder: 'Choose a ticket type',
                options: [
                  {
                    label: 'Guild Support',
                    value: 'guild_support',
                    description:
                      'Use this ticket for guild help, member issues, questions, or other guild-related support.',
                    emoji: { name: '🛡️' },
                  },
                  {
                    label: 'Request Giveaway',
                    value: 'request_giveaway',
                    description: 'Use this ticket to request a giveaway ticket.',
                    emoji: { name: '🎁' },
                  },
                  {
                    label: 'Guild Join Request',
                    value: 'request_role_crew_member_plus',
                    description: 'Verify your stat here to join the guild',
                    emoji: { name: '⭐' },
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

async function resetPanelTypeSelection(interaction) {
  if (!interaction?.message?.editable) {
    return;
  }

  await interaction.message.edit(getTicketPanelPayload()).catch(() => null);
}

function getTicketActionRow(channelId, closed) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CUSTOM_IDS.ticketActionSelectPrefix}${channelId}`)
      .setPlaceholder(closed ? 'This ticket has been closed' : 'Ticket Actions')
      .setDisabled(Boolean(closed))
      .addOptions([
        { label: 'Close Ticket', value: 'close_ticket', emoji: '⛔' },
        { label: 'Blacklist User', value: 'blacklist_user', emoji: '💀' },
      ]),
  );
}


function getRoleReviewActionRow(customId, placeholder = 'Choose review action', disabled = false) {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId,
        disabled,
        placeholder,
        options: [
          { label: 'Accept', value: 'accept_request', emoji: { name: '✅' } },
          { label: 'Deny', value: 'deny_request', emoji: { name: '❌' } },
        ],
      },
    ],
  };
}

function getInviteConfirmationActionRow(customId, disabled = false) {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId,
        disabled,
        placeholder: 'Confirm invited to guild?',
        options: [{ label: 'Confirm invited to guild?', value: 'confirm_invited_to_guild', emoji: { name: '📨' } }],
      },
    ],
  };
}

function getGiveawayReviewActionRow(customId, disabled = false) {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId,
        disabled,
        placeholder: disabled ? 'This giveaway request was reviewed' : 'Choose review action',
        options: [
          { label: 'Accept', value: 'accept_request', emoji: { id: '1498173245981986869', name: 'Y_' } },
          { label: 'Deny', value: 'deny_request', emoji: { id: '1498173244031631400', name: 'N_' } },
        ],
      },
    ],
  };
}

function getGiveawayClaimButtonRow(customId, disabled = false) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 1,
        custom_id: customId,
        label: 'Confirm claimed',
        disabled,
      },
    ],
  };
}

function formatUploadedFileList(uploadedEvidence) {
  const list = uploadedEvidence
    .slice(0, 10)
    .map((item, index) => `- [${sanitizeAttachmentName(item.filename, index)}](${item.url})`)
    .join('\n');

  return list || '- No files were detected from the form submission.';
}

function getUploadedMediaGallery(uploadedEvidence) {
  const items = uploadedEvidence
    .slice(0, 10)
    .map((item, index) => ({
      media: { url: item.url },
      description: sanitizeAttachmentName(item.filename, index),
    }));

  if (items.length === 0) {
    return null;
  }

  return {
    type: 12,
    items,
  };
}

function getRoleRequestReviewMessageComponents({
  userId,
  username,
  game = null,
  uploadedEvidence,
  statusText = null,
  statusColor = 0xffffff,
  statusNote = null,
}) {
  const uploadedFileList = formatUploadedFileList(uploadedEvidence);
  const mediaGallery = getUploadedMediaGallery(uploadedEvidence);
  const statusLine = statusText ? `\n\n**Status:** ${statusText}` : '';
  const statusNoteLine = statusNote ? `\n-# ${statusNote}` : '';

  return [
    {
      type: 17,
      accent_color: statusColor,
      components: [
        {
          type: 10,
          content:
            `### <@${userId}>'s ⭐Crew Member+ role request.\n` +
            `* userID: ${userId}\n` +
            `* Roblox username: ${username}\n` +
            `-# Game user player: ${game || '-'}` +
            statusLine +
            statusNoteLine,
        },
        { type: 14, divider: true, spacing: 1 },
        {
          type: 10,
          content: `**Uploaded files / media**\n${uploadedFileList}`,
        },
        ...(mediaGallery ? [mediaGallery] : []),
      ],
    },
  ];
}

function container(accent, content) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: accent,
        components: [{ type: 10, content }],
      },
    ],
  };
}

function sanitizeChannelName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function getFilenameFromUrl(url) {
  if (!url) {
    return 'file.unknown';
  }

  const clean = String(url).split('?')[0];
  const name = clean.split('/').pop();
  return name || 'file.unknown';
}

function getModalComponents(interaction) {
  const rawComponents = interaction.components ?? interaction?.data?.components ?? [];
  return Array.isArray(rawComponents) ? rawComponents : [];
}

function findSubmittedComponent(interaction, customId) {
  for (const wrapper of getModalComponents(interaction)) {
    const component = wrapper?.component ?? wrapper?.components?.[0] ?? null;
    if (component?.custom_id === customId || component?.customId === customId) {
      return component;
    }
  }
  return null;
}

function getGuildSupportTypeFromModal(interaction) {
  const radio = findSubmittedComponent(interaction, CUSTOM_IDS.guildSupportRadio);
  return radio?.value ?? radio?.values?.[0] ?? null;
}

function getCrewRoleGameFromModal(interaction) {
  const radio = findSubmittedComponent(interaction, CUSTOM_IDS.crewRoleGame);
  return radio?.value ?? radio?.values?.[0] ?? null;
}

function normalizeUploadedAttachment(attachment) {
  if (!attachment) {
    return null;
  }

  return {
    id: attachment.id,
    url: attachment.url,
    contentType: attachment.contentType || attachment.content_type || '',
    filename: attachment.name || attachment.filename || getFilenameFromUrl(attachment.url),
  };
}

function getUploadedAttachmentDetails(interaction) {
  const uploadedFiles = typeof interaction?.fields?.getUploadedFiles === 'function'
    ? interaction.fields.getUploadedFiles(CUSTOM_IDS.crewRoleEvidenceUpload) ?? []
    : [];
  const fromFieldAccessor = typeof interaction?.fields?.getUploadedFiles === 'function'
    ? Array.from(uploadedFiles).map(normalizeUploadedAttachment).filter(Boolean)
    : [];

  if (fromFieldAccessor.length > 0) {
    return fromFieldAccessor;
  }

  const fileUploadComponent = findSubmittedComponent(interaction, CUSTOM_IDS.crewRoleEvidenceUpload);
  const attachmentIds = Array.isArray(fileUploadComponent?.values) ? fileUploadComponent.values : [];
  const resolvedAttachments = interaction?.data?.resolved?.attachments ?? interaction?.resolved?.attachments ?? {};
  const fromResolved = attachmentIds
    .map((id) => normalizeUploadedAttachment(resolvedAttachments[id]))
    .filter(Boolean);

  if (fromResolved.length > 0) {
    return fromResolved;
  }

  return Array.from(interaction?.attachments?.values?.() ?? [])
    .map(normalizeUploadedAttachment)
    .filter(Boolean);
}


function sanitizeAttachmentName(filename, fallbackIndex = 0) {
  const base = String(filename || `upload-${fallbackIndex + 1}`).trim();
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return safe || `upload-${fallbackIndex + 1}`;
}

function getTextInputValueSafely(interaction, customId, fallback = '') {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return fallback;
  }
}

function getDurationMinutesFromInput(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(m|h|d)$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  if (match[2] === 'm') return amount;
  if (match[2] === 'h') return amount * 60;
  return amount * 60 * 24;
}

function validateDurationRange(value, minMinutes, maxMinutes) {
  const minutes = getDurationMinutesFromInput(value);
  if (minutes === null) {
    return {
      valid: false,
      message: 'Use format like `15m`, `2h`, or `3d`.',
    };
  }

  if (minutes < minMinutes || minutes > maxMinutes) {
    return {
      valid: false,
      message: `Value must be between ${minMinutes}m and ${maxMinutes >= 1440 ? `${Math.floor(maxMinutes / 1440)}d` : `${maxMinutes}m`}.`,
    };
  }

  return { valid: true, minutes };
}

function getGiveawayRequestMessageComponents({
  request,
  statusText,
  statusColor,
  deniedReason = null,
  claimedEvidence = [],
}) {
  const uploadedFileList = formatUploadedFileList(request.uploadedEvidence || []);
  const mediaGallery = getUploadedMediaGallery(request.uploadedEvidence || []);
  const claimedLinks = claimedEvidence.length > 0
    ? claimedEvidence
      .map((item, index) => `- [${sanitizeAttachmentName(item.filename, index)}](${item.url})`)
      .join('\n')
    : null;

  const legacyRequirement = request.requirement?.trim() ? request.requirement.trim() : 'If needed';
  const giveawayDetails = request.giveawayDetails?.trim()
    ? request.giveawayDetails.trim()
    : [
      `Winner amount: ${request.winnerCount || '-'}`,
      `Giveaway time: ${request.giveawayTime || '-'}`,
      `Claim time: ${request.claimTime || '-'}`,
      `Requirement: ${legacyRequirement}`,
    ].join('\n');

  return [
    {
      type: 17,
      accent_color: statusColor,
      components: [
        {
          type: 10,
          content:
            `## <@${request.userId}>'s Giveaway request.\n` +
            `-# * UserID: ${request.userId}\n` +
            `-# Details:\n${giveawayDetails}\n` +
            `-# Prize: ${request.prize}\n` +
            `### Status: ${statusText}` +
            (deniedReason ? `\n-# Reason: ${deniedReason}` : ''),
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `**Uploaded files / media**\n${uploadedFileList}` },
        ...(mediaGallery ? [mediaGallery] : []),
        ...(claimedLinks
          ? [{ type: 14, divider: true, spacing: 1 }, { type: 10, content: `**Claim proof links**\n${claimedLinks}` }]
          : []),
      ],
    },
  ];
}

async function ensurePanelMessage(guild, clientUserId) {
  const state = loadState();
  const channel = await guild.channels.fetch(TICKET_PANEL_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    saveState(state);
    return;
  }

  let panelMessage = null;
  const savedId = state.panelMessageIdByGuild[guild.id];
  if (savedId) {
    panelMessage = await channel.messages.fetch(savedId).catch(() => null);
    if (panelMessage) {
      await panelMessage.edit(getTicketPanelPayload()).catch(() => null);
    }
  }

  if (!panelMessage) {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    panelMessage =
      recent?.find((message) => message.author.id === clientUserId && message.components.length > 0 && message.flags.has(COMPONENTS_V2_FLAG)) ??
      null;

    if (panelMessage) {
      await panelMessage.edit(getTicketPanelPayload()).catch(() => null);
    }
  }

  if (!panelMessage) {
    panelMessage = await channel.send(getTicketPanelPayload()).catch(() => null);
  }

  if (panelMessage) {
    state.panelMessageIdByGuild[guild.id] = panelMessage.id;
  }

  saveState(state);
}

function getNextTicketId(state, guildId) {
  const current = Number(state.nextTicketIdByGuild[guildId] ?? 0) || 0;
  const next = current + 1;
  state.nextTicketIdByGuild[guildId] = next;
  return next;
}

function canUseStaffActions(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.has(STAFF_ROLE_ID);
}

async function createTicketChannel({ interaction, ticketTypeLabel, channelBaseName, questionAnswerPairs }) {
  const guild = interaction.guild;
  if (!guild) {
    return;
  }

  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const state = loadState();
  const blacklist = state.blacklistedUsersByGuild[guild.id] ?? [];
  if (blacklist.includes(interaction.user.id)) {
    if (interaction.deferred) {
      await interaction.editReply({ content: 'You are blacklisted from the ticket system.' });
    } else {
      await interaction.reply({ content: 'You are blacklisted from the ticket system.', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  const ticketId = getNextTicketId(state, guild.id);
  const channelName = `${channelBaseName}-${ticketId}`;

  const ticketChannel = await guild.channels.create({
    name: sanitizeChannelName(channelName),
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: STAFF_ROLE_ID,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
  });

  state.tickets[ticketChannel.id] = {
    guildId: guild.id,
    userId: interaction.user.id,
    ticketType: ticketTypeLabel,
    questionAnswerPairs,
    closed: false,
    createdAt: new Date().toISOString(),
  };
  saveState(state);

  const qnaLines = questionAnswerPairs.map((entry) => `**${entry.question}**\n${entry.answer || '-'}\n`).join('\n');
  const ticketDetailsComponents = [];
  if (qnaLines) {
    ticketDetailsComponents.push(
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: qnaLines },
      { type: 14, divider: true, spacing: 1 },
    );
  }

  await ticketChannel.send({
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content:
              `<@${interaction.user.id}> Welcome!\n## ${ticketTypeLabel}'s ticket\n` +
              '* Our staff will be with you soon, please be patience and provide necessary information so the help will be faster!',
          },
          ...ticketDetailsComponents,
        ],
      },
      getTicketActionRow(ticketChannel.id, false).toJSON(),
    ],
  });

  if (interaction.deferred) {
    await interaction.editReply({ content: `Your ticket has been created: ${ticketChannel}` });
  } else if (interaction.replied) {
    await interaction.followUp({ content: `Your ticket has been created: ${ticketChannel}`, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content: `Your ticket has been created: ${ticketChannel}`, flags: MessageFlags.Ephemeral });
  }
}

function toTitleCase(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function resolveTranscriptTicketType(channel, ticketRecord) {
  if (ticketRecord?.ticketType?.trim()) return ticketRecord.ticketType.trim();
  const base = channel.name.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
  return toTitleCase(base || 'Ticket');
}

function formatTranscriptTimestamp(dateInput) {
  const dt = new Date(dateInput);
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const year = dt.getFullYear();
  const hours = String(dt.getHours()).padStart(2, '0');
  const minutes = String(dt.getMinutes()).padStart(2, '0');
  return `${month}-${day}-${year}_${hours}-${minutes}`;
}

function normalizeCloseAction(action) {
  if (action === 'close_ticket') return 'close';
  if (action === 'blacklist_user') return 'blacklist_user';
  return action || 'close';
}

function getAttachmentTranscriptValue(attachment) {
  if (!attachment?.url) return '';

  const contentType = String(attachment.contentType || '').toLowerCase();
  const fileName = String(attachment.name || attachment.filename || '').toLowerCase();
  const isGif = contentType.includes('gif') || fileName.endsWith('.gif');
  const isImage = contentType.startsWith('image/');
  const isVideo = contentType.startsWith('video/');

  if (isGif) return `GIF: ${attachment.url}`;
  if (isImage) return `Image attachment: ${attachment.url}`;
  if (isVideo) return `Video attachment: ${attachment.url}`;
  return attachment.url;
}

async function saveTranscript(channel, options = {}) {
  const transcriptDir = path.join(__dirname, '..', 'transcripts');
  fs.mkdirSync(transcriptDir, { recursive: true });

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const sorted = messages ? [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp) : [];
  const lines = sorted.map((message) => {
    const ts = new Date(message.createdTimestamp);
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const time = `${hh}:${mm}`;
    const attachments = [...message.attachments.values()]
      .map((attachment) => getAttachmentTranscriptValue(attachment))
      .filter(Boolean)
      .join(' ');
    const content = `${message.content || ''} ${attachments}`.trim() || '[no content]';
    return `${time} // [${message.author.username}] - [${message.author.id}] : ${content}`;
  });

  const ticketType = resolveTranscriptTicketType(channel, options.ticketRecord);
  const timestamp = formatTranscriptTimestamp(new Date());
  const fileName = `${ticketType} - ${timestamp}.txt`;
  const filePath = path.join(transcriptDir, fileName);

  const headerLines = [
    `Ticket Channel: ${channel.name} (${channel.id})`,
    `Closed By: ${options.closedBy || 'Unknown'}`,
    `Close Action: ${normalizeCloseAction(options.closeAction)}`,
  ];
  fs.writeFileSync(filePath, `${headerLines.join('\n')}\n\n${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

async function handleTicketAction(interaction) {
  const state = loadState();
  const ticketRecord = state.tickets[interaction.channelId];
  if (!ticketRecord) {
    await interaction.reply({ content: 'This ticket record is missing.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (!canUseStaffActions(interaction.member)) {
    await interaction.reply({ content: 'Only staff can use ticket actions.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const action = interaction.values[0];
  const channel = interaction.channel;
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: 'Invalid channel.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const ticketOwner = await interaction.guild.members.fetch(ticketRecord.userId).catch(() => null);
  if (ticketOwner) {
    await channel.permissionOverwrites.edit(ticketOwner.id, { SendMessages: false }).catch(() => null);
  }

  if (action === 'blacklist_user') {
    const list = state.blacklistedUsersByGuild[interaction.guildId] ?? [];
    if (!list.includes(ticketRecord.userId)) {
      list.push(ticketRecord.userId);
      state.blacklistedUsersByGuild[interaction.guildId] = list;
      saveState(state);
    }

    await interaction.reply(container(0x000000, 'Blacklisted user from all ticket system.'));
  } else {
    await interaction.reply({ content: 'Closing ticket...', flags: MessageFlags.Ephemeral });
  }

  ticketRecord.closed = true;
  state.tickets[interaction.channelId] = ticketRecord;
  saveState(state);

  await channel.send(container(0xfff200, 'Transcript saving!...'));
  const transcriptPath = await saveTranscript(channel, {
    ticketRecord,
    closedBy: interaction.user.id,
    closeAction: action,
  });
  const transcriptChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (transcriptChannel?.isTextBased()) {
    await transcriptChannel
      .send({
        content: `Transcript for #${channel.name} (${channel.id})`,
        files: [transcriptPath],
      })
      .catch(() => null);
  }
  await channel.send(container(0x00ff00, 'Transcript saved!'));
  await channel.send(container(0xff0000, 'Deleting ticket...'));

  const original = await interaction.message.fetch().catch(() => null);
  if (original) {
    await original.edit({ components: [getTicketActionRow(interaction.channelId, true)] }).catch(() => null);
  }

  setTimeout(() => {
    channel.delete('Ticket closed').catch(() => null);
  }, 3000);

  return true;
}

async function handleRoleRequestReview(interaction) {
  if (!canUseStaffActions(interaction.member)) {
    await interaction.reply({ content: 'Only staff can review role requests.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const state = loadState();
  const requestId = interaction.customId.split(':').pop();
  const request = state.roleRequests[requestId];
  if (!request) {
    await interaction.reply({ content: 'Request not found.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const action = interaction.values[0];
  if (action === 'confirm_invited_to_guild') {
    if (request.status !== 'accepted') {
      await interaction.reply({
        content: 'This action is only available after the request is accepted.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.deferUpdate();

    request.status = 'accepted_invited';
    state.roleRequests[requestId] = request;
    saveState(state);

    await interaction.editReply({
      components: [
        ...getRoleRequestReviewMessageComponents({
          userId: request.userId,
          username: request.username,
          game: request.game,
          uploadedEvidence: request.uploadedEvidence || [],
          statusText: '⭐ Accepted + INVITED',
          statusColor: 0x00ff00,
          statusNote: 'The author has been invited to guild',
        }),
        getInviteConfirmationActionRow(interaction.customId, true),
      ],
    });
    return true;
  }

  if (action === 'deny_request') {
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_IDS.denyReasonPrefix}${requestId}`).setTitle('Deny request');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deny_reason')
          .setStyle(TextInputStyle.Paragraph)
          .setLabel('Reason?')
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
    await interaction.showModal(modal);
    return true;
  }

  await interaction.deferUpdate();

  const guild = interaction.guild;
  const member = await guild.members.fetch(request.userId).catch(() => null);
  if (member) {
    await member.roles.add(getCrewMemberPlusRoleIdForGame(request.game)).catch(() => null);
    await member
      .send(
        container(
          0x00ff00,
          'Your **⭐Crew Member+** role request has been accepted!\n' +
            '-# To join the guild, please send us a request in the in-game guild system. Guild ID: 225083223',
        ),
      )
      .catch(() => null);
  }

  request.status = 'accepted';
  state.roleRequests[requestId] = request;
  saveState(state);

  await interaction.editReply({
    components: [
      ...getRoleRequestReviewMessageComponents({
        userId: request.userId,
        username: request.username,
        game: request.game,
        uploadedEvidence: request.uploadedEvidence || [],
        statusText: '✅ Accepted',
        statusColor: 0xd5f5e3,
        statusNote: 'This request has been accepted.',
      }),
      getInviteConfirmationActionRow(interaction.customId),
    ],
  });

  return true;
}

async function handleGiveawayRequestReview(interaction) {
  if (!canUseStaffActions(interaction.member)) {
    await interaction.reply({ content: 'Only staff can review giveaway requests.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const requestId = interaction.customId.split(':').pop();
  const state = loadState();
  const request = state.giveawayRequests[requestId];
  if (!request) {
    await interaction.reply({ content: 'Giveaway request not found.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const action = interaction.values[0];
  if (action === 'deny_request') {
    const modal = new ModalBuilder()
      .setCustomId(`${CUSTOM_IDS.giveawayDenyReasonPrefix}${requestId}`)
      .setTitle('Deny giveaway request');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deny_reason')
          .setStyle(TextInputStyle.Paragraph)
          .setLabel('Reason for denial')
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
    await interaction.showModal(modal);
    return true;
  }

  await interaction.deferUpdate();

  request.status = 'accepted';
  state.giveawayRequests[requestId] = request;
  saveState(state);

  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  if (member) {
    await member
      .send(
        container(
          0x00ff00,
          `### <@${request.userId}> Your giveaway request has been accepted!\n` +
            'Note:\n' +
            '* If a winner DMs you to claim their prize, give it only if they claim within the allowed claim time.\n' +
            '* Provide staff with image proof showing that you have given the prize to the winner.\n' +
            '\n-# IF you break our giveaway rules, you may be banned / blacklisted.',
        ),
      )
      .catch(() => null);
  }

  await interaction.editReply({
    flags: COMPONENTS_V2_FLAG,
    components: [
      ...getGiveawayRequestMessageComponents({
        request,
        statusText: 'Accepted ✅',
        statusColor: 0xd5f5e3,
      }),
      getGiveawayClaimButtonRow(`${CUSTOM_IDS.giveawayConfirmClaimPrefix}${requestId}`),
    ],
  });
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Resend the ticket panel in the configured channel (admin only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async init(client) {
    for (const guild of client.guilds.cache.values()) {
      await ensurePanelMessage(guild, client.user.id);
    }
  },

  async execute(interaction, client) {
    await ensurePanelMessage(interaction.guild, client.user.id);
    await interaction.reply({ content: 'Ticket panel checked and updated.', flags: MessageFlags.Ephemeral });
  },

  async handleInteraction(interaction) {
    if (!interaction.guildId) {
      return false;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === CUSTOM_IDS.panelTypeSelect) {
      const selected = interaction.values[0];
      await resetPanelTypeSelection(interaction);

      if (selected === 'guild_support') {
        await interaction.showModal({
          custom_id: CUSTOM_IDS.guildSupportModal,
          title: 'Guild Support',
          components: [
            {
              type: 18,
              label: 'What type of support do you need?',
              component: {
                type: 21,
                custom_id: CUSTOM_IDS.guildSupportRadio,
                required: true,
                options: [
                  { value: 'Member Report', label: 'Member Report' },
                  { value: 'Other Support', label: 'Other Support' },
                ],
              },
            },
          ],
        });
        return true;
      }

      if (selected === 'request_giveaway') {
        await createTicketChannel({
          interaction,
          ticketTypeLabel: 'Giveaway Request',
          channelBaseName: 'Giveaway-Request',
          questionAnswerPairs: [],
        });
        return true;
      }

      if (selected === 'request_role_crew_member_plus') {
        await interaction.showModal({
          custom_id: CUSTOM_IDS.crewRoleRequestModal,
          title: 'Crew Member+ request',
          components: [
            {
              type: 18,
              label: 'What game you playing',
              component: {
                type: 21,
                custom_id: CUSTOM_IDS.crewRoleGame,
                required: true,
                options: [
                  { value: 'Universe Tower Defense X', label: 'Universe Tower Defense X' },
                  { value: 'Sailor Piece', label: 'Sailor Piece' },
                ],
              },
            },
            {
              type: 18,
              label: 'What is your Roblox username?',
              component: {
                type: 4,
                custom_id: CUSTOM_IDS.crewRoleUsername,
                style: 2,
                required: true,
                max_length: 300,
              },
            },
            {
              type: 18,
              label: 'Upload proof you meet role requirements',
              description: 'Upload screenshots/videos/files.',
              component: {
                type: 19,
                custom_id: CUSTOM_IDS.crewRoleEvidenceUpload,
                min_values: 0,
                max_values: 10,
                required: false,
              },
            },
          ],
        });
        return true;
      }

    }

    if (interaction.isModalSubmit() && interaction.customId === CUSTOM_IDS.guildSupportModal) {
      const answer = getGuildSupportTypeFromModal(interaction) || 'Other Support';
      await createTicketChannel({
        interaction,
        ticketTypeLabel: 'Guild Support',
        channelBaseName: 'guild-support',
        questionAnswerPairs: [{ question: 'What type of support do you need?', answer }],
      });
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === CUSTOM_IDS.crewRoleRequestModal) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
      }

      const game = getCrewRoleGameFromModal(interaction) || '-';
      const username = getTextInputValueSafely(interaction, CUSTOM_IDS.crewRoleUsername, '-');
      const uploadedEvidence = getUploadedAttachmentDetails(interaction);

      const state = loadState();
      const requestId = `${interaction.guildId}-${interaction.user.id}-${Date.now()}`;
      state.roleRequests[requestId] = {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        game,
        username,
        uploadedEvidence,
        status: 'pending',
      };
      saveState(state);

      const files = uploadedEvidence.slice(0, 10).map((item, index) => ({
        attachment: item.url,
        name: sanitizeAttachmentName(item.filename, index),
      }));

      const reviewChannel = await interaction.guild.channels.fetch(ROLE_REQUEST_REVIEW_CHANNEL_ID).catch(() => null);
      if (!reviewChannel?.isTextBased()) {
        const payload = {
          ...container(0xffffff, 'Request channel is not available right now.'),
          flags: COMPONENTS_V2_FLAG,
        };
        if (interaction.deferred) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral | COMPONENTS_V2_FLAG });
        }
        return true;
      }

      await reviewChannel.send({
        flags: COMPONENTS_V2_FLAG,
        files,
        components: [
          ...getRoleRequestReviewMessageComponents({
            userId: interaction.user.id,
            username,
            game,
            uploadedEvidence,
            statusColor: 0xf8f9f9,
          }),
          getRoleReviewActionRow(`${CUSTOM_IDS.roleReviewSelectPrefix}${requestId}`),
        ],
      });

      const payload = {
        ...container(0xffffff, 'Your Crew Member+ role request has been submitted.'),
        flags: COMPONENTS_V2_FLAG,
      };
      if (interaction.deferred) {
        await interaction.editReply(payload);
      } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral | COMPONENTS_V2_FLAG });
      }
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(CUSTOM_IDS.ticketActionSelectPrefix)) {
      return handleTicketAction(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(CUSTOM_IDS.roleReviewSelectPrefix)) {
      if (interaction.values[0] === 'deny_request') {
        await interaction.message
          .edit({
            components: [
              ...interaction.message.components.slice(0, -1).map((component) => component.toJSON()),
              getRoleReviewActionRow(interaction.customId),
            ],
          })
          .catch(() => null);
      }

      return handleRoleRequestReview(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(CUSTOM_IDS.giveawayReviewSelectPrefix)) {
      return handleGiveawayRequestReview(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(CUSTOM_IDS.denyReasonPrefix)) {
      const requestId = interaction.customId.split(':').pop();
      const reason = interaction.fields.getTextInputValue('deny_reason');
      const state = loadState();
      const request = state.roleRequests[requestId];
      if (!request) {
        await interaction.reply({ content: 'Request not found.', flags: MessageFlags.Ephemeral });
        return true;
      }

      request.status = 'denied';
      request.reason = reason;
      state.roleRequests[requestId] = request;
      saveState(state);

      const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
      if (member) {
        await member
          .send(container(0xff0000, `You **⭐Crew Member+** role request has been denied!.\n-# Reason: ${reason}`))
          .catch(() => null);
      }

      await interaction.update({
        flags: COMPONENTS_V2_FLAG,
        components: [
          ...getRoleRequestReviewMessageComponents({
            userId: request.userId,
            username: request.username,
            game: request.game,
            uploadedEvidence: request.uploadedEvidence || [],
            statusText: '❌ Denied',
            statusColor: 0xf5b7b1,
            statusNote: `Reason: ${reason}\nThis request has been denied.`,
          }),
          getInviteConfirmationActionRow(`${CUSTOM_IDS.roleReviewSelectPrefix}${requestId}`),
        ],
      });
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(CUSTOM_IDS.giveawayDenyReasonPrefix)) {
      const requestId = interaction.customId.split(':').pop();
      const reason = interaction.fields.getTextInputValue('deny_reason');
      const state = loadState();
      const request = state.giveawayRequests[requestId];
      if (!request) {
        await interaction.reply({ content: 'Giveaway request not found.', flags: MessageFlags.Ephemeral });
        return true;
      }

      request.status = 'denied';
      request.deniedReason = reason;
      state.giveawayRequests[requestId] = request;
      saveState(state);

      const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
      if (member) {
        await member
          .send(container(0x00ff00, `### <@${request.userId}> Your giveaway request has been denied!\nReason: ${reason}`))
          .catch(() => null);
      }

      await interaction.update({
        flags: COMPONENTS_V2_FLAG,
        components: [
          ...getGiveawayRequestMessageComponents({
            request,
            statusText: 'Denied ❌',
            statusColor: 0xf5b7b1,
            deniedReason: reason,
          }),
          getGiveawayReviewActionRow(`${CUSTOM_IDS.giveawayReviewSelectPrefix}${requestId}`, true),
        ],
      });
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(CUSTOM_IDS.giveawayConfirmClaimPrefix)) {
      if (!canUseStaffActions(interaction.member)) {
        await interaction.reply({ content: 'Only staff can confirm giveaway claims.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const requestId = interaction.customId.split(':').pop();
      const state = loadState();
      const request = state.giveawayRequests[requestId];
      if (!request || request.status !== 'accepted') {
        await interaction.reply({ content: 'This giveaway request is not ready for claim confirmation.', flags: MessageFlags.Ephemeral });
        return true;
      }

      await interaction.showModal({
        custom_id: `${CUSTOM_IDS.giveawayClaimEvidenceModalPrefix}${requestId}`,
        title: 'Confirm giveaway claim',
        components: [
          {
            type: 18,
            label: 'Provide evidence of the winner claimed prize',
            component: {
              type: 19,
              custom_id: CUSTOM_IDS.giveawayClaimEvidenceUpload,
              min_values: 1,
              max_values: 10,
              required: true,
            },
          },
        ],
      });
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(CUSTOM_IDS.giveawayClaimEvidenceModalPrefix)) {
      const requestId = interaction.customId.split(':').pop();
      const state = loadState();
      const request = state.giveawayRequests[requestId];
      if (!request) {
        await interaction.reply({ content: 'Giveaway request not found.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const claimEvidence = (
        typeof interaction?.fields?.getUploadedFiles === 'function'
          ? Array.from(interaction.fields.getUploadedFiles(CUSTOM_IDS.giveawayClaimEvidenceUpload) ?? []).map(normalizeUploadedAttachment).filter(Boolean)
          : []
      );
      if (claimEvidence.length === 0) {
        await interaction.reply({ content: 'Please upload at least one proof file.', flags: MessageFlags.Ephemeral });
        return true;
      }

      request.status = 'claimed';
      request.claimedEvidence = claimEvidence;
      state.giveawayRequests[requestId] = request;
      saveState(state);

      const reviewChannel = await interaction.guild.channels.fetch(GIVEAWAY_REQUEST_REVIEW_CHANNEL_ID).catch(() => null);
      if (reviewChannel?.isTextBased()) {
        const files = claimEvidence.slice(0, 10).map((item, index) => ({
          attachment: item.url,
          name: sanitizeAttachmentName(item.filename, index),
        }));

        await reviewChannel.send({
          content: `Claim proof for <@${request.userId}>'s giveaway request (${requestId})`,
          files,
        }).catch(() => null);
      }

      await interaction.update({
        flags: COMPONENTS_V2_FLAG,
        components: [
          ...getGiveawayRequestMessageComponents({
            request,
            statusText: 'CLAIMED✅',
            statusColor: 0x00ff00,
            claimedEvidence: claimEvidence,
          }),
          getGiveawayClaimButtonRow(`${CUSTOM_IDS.giveawayConfirmClaimPrefix}${requestId}`, true),
        ],
      });
      return true;
    }

    return false;
  },
};
