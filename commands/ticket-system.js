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
const { DEFAULT_GUILD_CONFIG, getGuildConfig, resolveLoggingChannelId } = require('../src/serverConfig');
const {
  DEFAULT_AUTHOR_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  buildTicketMessagePayload,
  discordEmoji,
  formatFormAnswers,
  orderAdminActions,
} = require('../src/ticketConfig');

const TICKET_PANEL_CHANNEL_ID = DEFAULT_GUILD_CONFIG.channels.ticketPanel;
const TICKET_CATEGORY_ID = DEFAULT_GUILD_CONFIG.channels.ticketCategory;
const ROLE_REQUEST_REVIEW_CHANNEL_ID = DEFAULT_GUILD_CONFIG.channels.roleRequestReview;
const GIVEAWAY_REQUEST_REVIEW_CHANNEL_ID = DEFAULT_GUILD_CONFIG.channels.giveawayRequestReview;
const TRANSCRIPT_CHANNEL_ID = DEFAULT_GUILD_CONFIG.channels.transcript;
const STAFF_ROLE_ID = DEFAULT_GUILD_CONFIG.roles.staff;
const CREW_MEMBER_PLUS_ROLE_ID = DEFAULT_GUILD_CONFIG.roles.crewMemberPlus;
const UTDX_CREW_MEMBER_PLUS_ROLE_ID = DEFAULT_GUILD_CONFIG.roles.utdxCrewMemberPlus;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

const CUSTOM_IDS = {
  panelTypeSelect: 'ticket:type-select',
  panelTypeButtonPrefix: 'ticket:type-button:',
  createFormPrefix: 'ticket:create-form:',
  adminSelectPrefix: 'ticket:admin-select:',
  adminButtonPrefix: 'ticket:admin-button:',
  closeFormPrefix: 'ticket:close-form:',
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

function getTicketConfig(guildId) {
  return getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG;
}

function getCrewMemberPlusRoleIdForGame(game, guildId) {
  const roles = getTicketConfig(guildId).roles;
  const normalizedGame = String(game || '').trim().toLowerCase();
  return normalizedGame === 'universe tower defense x' || normalizedGame === 'utdx'
    ? roles.utdxCrewMemberPlus || UTDX_CREW_MEMBER_PLUS_ROLE_ID
    : roles.crewMemberPlus || CREW_MEMBER_PLUS_ROLE_ID;
}

function getTicketTypes(guildId) {
  const config = getTicketConfig(guildId);
  return Array.isArray(config.tickets?.types) ? config.tickets.types : [];
}

function findTicketType(guildId, ticketTypeId) {
  return getTicketTypes(guildId).find((ticketType) => ticketType.id === ticketTypeId) || null;
}

function buttonStyleValue(style) {
  return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2;
}

function getTicketPanelControls(ticketConfig) {
  if (!ticketConfig.enabled) return [];
  const types = Array.isArray(ticketConfig.types) ? ticketConfig.types : [];
  if (types.length === 0) return [];
  if (ticketConfig.launcherStyle === 'buttons') {
    const rows = [];
    for (let index = 0; index < types.length; index += 5) {
      rows.push({
        type: 1,
        components: types.slice(index, index + 5).map((ticketType) => ({
          type: 2,
          custom_id: `${CUSTOM_IDS.panelTypeButtonPrefix}${ticketType.id}`,
          label: ticketType.name,
          style: buttonStyleValue(ticketType.buttonStyle),
          ...(ticketType.emoji ? { emoji: discordEmoji(ticketType.emoji) } : {}),
        })),
      });
    }
    return rows;
  }
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: CUSTOM_IDS.panelTypeSelect,
      placeholder: 'Choose a ticket type',
      options: types.map((ticketType) => ({
        label: ticketType.name,
        value: ticketType.id,
        ...(ticketType.description ? { description: ticketType.description } : {}),
        ...(ticketType.emoji ? { emoji: discordEmoji(ticketType.emoji) } : {}),
      })),
    }],
  }];
}

function getTicketPanelPayload(guild) {
  const ticketConfig = getTicketConfig(guild.id).tickets;
  return buildTicketMessagePayload(
    ticketConfig.launcherMessage,
    { server: guild.name },
    getTicketPanelControls(ticketConfig),
  );
}

async function resetPanelTypeSelection(interaction) {
  if (!interaction?.message?.editable) {
    return;
  }

  await interaction.message.edit(getTicketPanelPayload(interaction.guild)).catch(() => null);
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

function getGiveawayReviewActionRow(customId, disabled = false, guildId = null) {
  const emojis = getTicketConfig(guildId).emojis || DEFAULT_GUILD_CONFIG.emojis;
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: customId,
        disabled,
        placeholder: disabled ? 'This giveaway request was reviewed' : 'Choose review action',
        options: [
          { label: 'Accept', value: 'accept_request', emoji: emojis.giveawayRequestAccept },
          { label: 'Deny', value: 'deny_request', emoji: emojis.giveawayRequestDeny },
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
  const list = (Array.isArray(uploadedEvidence) ? uploadedEvidence : [])
    .filter((item) => isValidUploadUrl(item?.url))
    .slice(0, 10)
    .map((item, index) => `- [${sanitizeAttachmentName(item.filename, index)}](${item.url})`)
    .join('\n');

  return list || '- No files were detected from the form submission.';
}

function getUploadedMediaGallery(uploadedEvidence) {
  const items = (Array.isArray(uploadedEvidence) ? uploadedEvidence : [])
    .filter((item) => isValidUploadUrl(item?.url))
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

  const url = attachment.url || attachment.proxyURL || attachment.proxy_url || attachment.attachment;
  if (!isValidUploadUrl(url)) {
    return null;
  }

  return {
    id: attachment.id,
    url,
    contentType: attachment.contentType || attachment.content_type || '',
    filename: attachment.name || attachment.filename || getFilenameFromUrl(url),
  };
}

function isValidUploadUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function getUploadedEvidenceFiles(uploadedEvidence) {
  return (Array.isArray(uploadedEvidence) ? uploadedEvidence : [])
    .filter((item) => isValidUploadUrl(item?.url))
    .slice(0, 10)
    .map((item, index) => ({
      attachment: item.url,
      name: sanitizeAttachmentName(item.filename, index),
    }));
}

function collectionToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return Array.from(value.values());
  return [value];
}

function getResolvedAttachment(resolvedAttachments, id) {
  if (!resolvedAttachments || !id) return null;
  if (typeof resolvedAttachments.get === 'function') return resolvedAttachments.get(id) ?? null;
  return resolvedAttachments[id] ?? null;
}

function getSubmittedUploadIds(interaction, customId) {
  const component = findSubmittedComponent(interaction, customId);
  const values = component?.values ?? component?.value ?? [];
  return Array.isArray(values) ? values : [values].filter(Boolean);
}

function getUploadedAttachmentDetails(interaction, customId = CUSTOM_IDS.crewRoleEvidenceUpload) {
  const uploadedFiles = typeof interaction?.fields?.getUploadedFiles === 'function'
    ? interaction.fields.getUploadedFiles(customId) ?? []
    : [];
  const fromFieldAccessor = typeof interaction?.fields?.getUploadedFiles === 'function'
    ? collectionToArray(uploadedFiles).map(normalizeUploadedAttachment).filter(Boolean)
    : [];

  if (fromFieldAccessor.length > 0) {
    return fromFieldAccessor;
  }

  const attachmentIds = getSubmittedUploadIds(interaction, customId);
  const resolvedAttachments = interaction?.data?.resolved?.attachments ?? interaction?.resolved?.attachments ?? {};
  const fromResolved = attachmentIds
    .map((id) => normalizeUploadedAttachment(getResolvedAttachment(resolvedAttachments, id)))
    .filter(Boolean);

  if (fromResolved.length > 0) {
    return fromResolved;
  }

  return collectionToArray(interaction?.attachments)
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

function permissionBits(permissionNames, fallback) {
  const source = Array.isArray(permissionNames) ? permissionNames : fallback;
  return source.map((name) => PermissionFlagsBits[name]).filter((value) => value !== undefined);
}

function ticketQuestionCustomId(index) {
  return `ticket_question_${index + 1}`;
}

function modalOptionPayload(option, index) {
  return {
    label: option.name,
    value: String(index),
    ...(option.description ? { description: option.description } : {}),
    ...(option.emoji ? { emoji: discordEmoji(option.emoji) } : {}),
  };
}

function ticketQuestionComponent(question, index) {
  const customId = ticketQuestionCustomId(index);
  const required = Boolean(question.required);
  if (question.type === 'text_display') {
    return { type: 10, content: question.question };
  }

  let component;
  if (question.type === 'text_input') {
    component = {
      type: 4,
      custom_id: customId,
      style: question.textStyle === 'short' ? 1 : 2,
      min_length: question.minLength,
      max_length: question.maxLength,
      required,
      ...(question.placeholder ? { placeholder: question.placeholder } : {}),
    };
  } else if (question.type === 'string_select') {
    component = {
      type: 3,
      custom_id: customId,
      options: question.options.map(modalOptionPayload),
      min_values: question.minValues,
      max_values: question.maxValues,
      required,
      ...(question.placeholder ? { placeholder: question.placeholder } : {}),
    };
  } else if (question.type === 'user_select') {
    component = {
      type: 5,
      custom_id: customId,
      min_values: question.minValues,
      max_values: question.maxValues,
      required,
      ...(question.placeholder ? { placeholder: question.placeholder } : {}),
    };
  } else if (question.type === 'role_select') {
    component = {
      type: 6,
      custom_id: customId,
      min_values: question.minValues,
      max_values: question.maxValues,
      required,
      ...(question.placeholder ? { placeholder: question.placeholder } : {}),
    };
  } else if (question.type === 'channel_select') {
    component = {
      type: 8,
      custom_id: customId,
      min_values: question.minValues,
      max_values: question.maxValues,
      required,
      ...(question.placeholder ? { placeholder: question.placeholder } : {}),
    };
  } else if (question.type === 'file_upload') {
    component = {
      type: 19,
      custom_id: customId,
      min_values: required ? 1 : 0,
      max_values: question.maxFiles,
      required,
    };
  } else if (question.type === 'radio_group') {
    component = {
      type: 21,
      custom_id: customId,
      required,
      options: question.options.map((option, optionIndex) => ({
        label: option.name,
        value: String(optionIndex),
        ...(option.description ? { description: option.description } : {}),
      })),
    };
  } else if (question.type === 'checkbox_group') {
    component = {
      type: 22,
      custom_id: customId,
      required,
      min_values: question.minValues,
      max_values: question.maxValues,
      options: question.options.map((option, optionIndex) => ({
        label: option.name,
        value: String(optionIndex),
        ...(option.description ? { description: option.description } : {}),
      })),
    };
  } else {
    component = {
      type: 23,
      custom_id: customId,
      default: Boolean(question.default),
    };
  }

  return {
    type: 18,
    label: question.question,
    component,
  };
}

function getTicketFormModal(ticketType, phase, channelId = '', controlId = '') {
  const questions = ticketType.forms?.[phase] || [];
  const customId = phase === 'close'
    ? `${CUSTOM_IDS.closeFormPrefix}${channelId}:${controlId}`
    : `${CUSTOM_IDS.createFormPrefix}${ticketType.id}`;
  return {
    custom_id: customId,
    title: `${phase === 'close' ? 'Close' : 'Create'} ${ticketType.name}`.slice(0, 45),
    components: questions.map(ticketQuestionComponent),
  };
}

function getSubmittedValues(interaction, customId) {
  const component = findSubmittedComponent(interaction, customId);
  const raw = component?.values ?? component?.value ?? [];
  return Array.isArray(raw) ? raw : [raw].filter((value) => value !== undefined && value !== null);
}

function ticketFormAnswers(interaction, questions) {
  return (Array.isArray(questions) ? questions : []).map((question, index) => {
    const customId = ticketQuestionCustomId(index);
    let answer = '';
    let uploadedFiles = [];
    if (question.type === 'text_display') {
      return { order: question.order, question: question.question, type: question.type, answer: '' };
    }
    if (question.type === 'text_input') {
      answer = getTextInputValueSafely(interaction, customId, '');
    } else if (question.type === 'file_upload') {
      uploadedFiles = getUploadedAttachmentDetails(interaction, customId);
      answer = uploadedFiles.map((file) => `[${file.filename}](${file.url})`).join('\n');
    } else if (question.type === 'checkbox') {
      const value = getSubmittedValues(interaction, customId)[0];
      answer = value === true || value === 'true' ? 'Yes' : 'No';
    } else {
      const values = getSubmittedValues(interaction, customId);
      if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) {
        answer = values.map((value) => question.options?.[Number(value)]?.name || value).join(', ');
      } else if (question.type === 'user_select') {
        answer = values.map((value) => `<@${value}>`).join(', ');
      } else if (question.type === 'role_select') {
        answer = values.map((value) => `<@&${value}>`).join(', ');
      } else if (question.type === 'channel_select') {
        answer = values.map((value) => `<#${value}>`).join(', ');
      }
    }
    return {
      order: question.order,
      question: question.question,
      type: question.type,
      answer,
      uploadedFiles,
    };
  });
}

function getConfiguredAdminComponents(ticketType, channelId, disabled = false) {
  if (!ticketType.adminPanel?.enabled) return [];
  const controls = Array.isArray(ticketType.adminPanel.controls) ? ticketType.adminPanel.controls : [];
  if (ticketType.adminPanel.style === 'buttons') {
    const rows = [];
    for (let index = 0; index < controls.length; index += 5) {
      const components = controls.slice(index, index + 5).map((control) => {
        if (control.url) {
          return {
            type: 2,
            label: control.name,
            style: 5,
            url: control.url,
            disabled,
          };
        }
        return {
          type: 2,
          custom_id: `${CUSTOM_IDS.adminButtonPrefix}${channelId}:${control.id}`,
          label: control.name,
          style: buttonStyleValue(control.buttonStyle),
          disabled,
          ...(control.emoji ? { emoji: discordEmoji(control.emoji) } : {}),
        };
      });
      if (components.length) rows.push({ type: 1, components });
    }
    return rows;
  }

  const options = controls.filter((control) => !control.url).map((control) => ({
    label: control.name,
    value: control.id,
    ...(control.description ? { description: control.description } : {}),
    ...(control.emoji ? { emoji: discordEmoji(control.emoji) } : {}),
  }));
  if (!options.length) return [];
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `${CUSTOM_IDS.adminSelectPrefix}${channelId}`,
      placeholder: disabled ? 'Ticket actions are disabled' : 'Ticket actions',
      disabled,
      options,
    }],
  }];
}

async function ensurePanelMessage(guild, clientUserId) {
  const state = loadState();
  const guildConfig = getTicketConfig(guild.id);
  const panelChannelId = guildConfig.channels.ticketPanel || TICKET_PANEL_CHANNEL_ID;
  const savedId = state.panelMessageIdByGuild[guild.id];
  const savedChannelId = state.panelChannelIdByGuild?.[guild.id];
  if (savedId && savedChannelId && savedChannelId !== panelChannelId) {
    const previousChannel = await guild.channels.fetch(savedChannelId).catch(() => null);
    const previousMessage = previousChannel?.isTextBased()
      ? await previousChannel.messages.fetch(savedId).catch(() => null)
      : null;
    if (previousMessage) await previousMessage.delete().catch(() => null);
    delete state.panelMessageIdByGuild[guild.id];
  }

  if (!guildConfig.tickets?.enabled) {
    const existingChannelId = savedChannelId || panelChannelId;
    const existingChannel = await guild.channels.fetch(existingChannelId).catch(() => null);
    const existingMessage = existingChannel?.isTextBased() && savedId
      ? await existingChannel.messages.fetch(savedId).catch(() => null)
      : null;
    if (existingMessage) await existingMessage.delete().catch(() => null);
    delete state.panelMessageIdByGuild[guild.id];
    delete state.panelChannelIdByGuild[guild.id];
    saveState(state);
    return;
  }

  const channel = await guild.channels.fetch(panelChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    saveState(state);
    return;
  }

  let panelMessage = null;
  const currentSavedId = state.panelMessageIdByGuild[guild.id];
  if (currentSavedId) {
    panelMessage = await channel.messages.fetch(currentSavedId).catch(() => null);
    if (panelMessage) {
      await panelMessage.edit(getTicketPanelPayload(guild)).catch(() => null);
    }
  }

  if (!panelMessage) {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    panelMessage =
      recent?.find((message) => message.author.id === clientUserId && message.components.length > 0 && message.flags.has(COMPONENTS_V2_FLAG)) ??
      null;

    if (panelMessage) {
      await panelMessage.edit(getTicketPanelPayload(guild)).catch(() => null);
    }
  }

  if (!panelMessage) {
    panelMessage = await channel.send(getTicketPanelPayload(guild)).catch(() => null);
  }

  if (panelMessage) {
    state.panelMessageIdByGuild[guild.id] = panelMessage.id;
    state.panelChannelIdByGuild[guild.id] = channel.id;
  }

  saveState(state);
}

function getNextTicketId(state, guildId) {
  const current = Number(state.nextTicketIdByGuild[guildId] ?? 0) || 0;
  const next = current + 1;
  state.nextTicketIdByGuild[guildId] = next;
  return next;
}

function canUseStaffActions(member, ticketType = null) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const fallbackRoleId = getTicketConfig(member.guild?.id).roles.staff || STAFF_ROLE_ID;
  const roleIds = ticketType?.staffRoleIds?.length ? ticketType.staffRoleIds : [fallbackRoleId];
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function createTicketChannel({
  interaction,
  ticketType = null,
  ticketTypeLabel,
  channelBaseName,
  questionAnswerPairs = [],
}) {
  const guild = interaction.guild;
  if (!guild) {
    return;
  }

  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const state = loadState();
  const blacklist = state.blacklistedUsersByGuild[guild.id] ?? [];
  const member = interaction.member;
  const configuredBlacklistRole = ticketType?.blacklistRoleId;
  const hasBlacklistRole = Boolean(configuredBlacklistRole && member?.roles?.cache?.has(configuredBlacklistRole));
  if (blacklist.includes(interaction.user.id) || hasBlacklistRole) {
    if (interaction.deferred) {
      await interaction.editReply({ content: 'You are blacklisted from the ticket system.' });
    } else {
      await interaction.reply({ content: 'You are blacklisted from the ticket system.', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  const ticketId = getNextTicketId(state, guild.id);
  const resolvedLabel = ticketType?.name || ticketTypeLabel || 'Support';
  const channelName = `${channelBaseName || resolvedLabel}-${ticketId}`;
  const ticketConfig = getTicketConfig(guild.id);
  const ticketCategoryId = ticketType?.categoryChannelId || ticketConfig.channels.ticketCategory || TICKET_CATEGORY_ID;
  const fallbackStaffRoleId = ticketConfig.roles.staff || STAFF_ROLE_ID;
  const staffRoleIds = ticketType?.staffRoleIds?.length ? ticketType.staffRoleIds : [fallbackStaffRoleId];
  await guild.roles.fetch().catch(() => null);
  const validStaffRoleIds = staffRoleIds.filter((roleId) => guild.roles.cache.has(roleId));
  const authorPermissions = permissionBits(ticketType?.authorPermissions, DEFAULT_AUTHOR_PERMISSIONS);
  const staffPermissions = permissionBits(ticketType?.staffPermissions, DEFAULT_STAFF_PERMISSIONS);
  const ticketCategory = await guild.channels.fetch(ticketCategoryId).catch(() => null);
  const channelOptions = {
    name: sanitizeChannelName(channelName),
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: authorPermissions,
      },
      ...validStaffRoleIds.map((roleId) => ({ id: roleId, allow: staffPermissions })),
    ],
  };

  if (ticketCategory?.type === ChannelType.GuildCategory) {
    channelOptions.parent = ticketCategory.id;
  }

  const ticketChannel = await guild.channels.create(channelOptions);

  state.tickets[ticketChannel.id] = {
    guildId: guild.id,
    userId: interaction.user.id,
    ticketTypeId: ticketType?.id || '',
    ticketType: resolvedLabel,
    ticketTypeSnapshot: ticketType || null,
    questionAnswerPairs,
    closed: false,
    createdAt: new Date().toISOString(),
  };
  saveState(state);

  const adminComponents = ticketType
    ? getConfiguredAdminComponents(ticketType, ticketChannel.id)
    : [getTicketActionRow(ticketChannel.id, false).toJSON()];
  const messagePayload = ticketType
    ? buildTicketMessagePayload(ticketType.message, {
      mention: `<@${interaction.user.id}>`,
      username: interaction.user.username,
      displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      userId: interaction.user.id,
      ticketName: resolvedLabel,
      ticketId,
      channel: `<#${ticketChannel.id}>`,
      server: guild.name,
      avatarUrl: interaction.user.displayAvatarURL(),
      formAnswers: formatFormAnswers(questionAnswerPairs),
    }, adminComponents)
    : {
      flags: COMPONENTS_V2_FLAG,
      components: [
        {
          type: 17,
          accent_color: 0xffffff,
          components: [{
            type: 10,
            content: `<@${interaction.user.id}> Welcome!\n## ${resolvedLabel} ticket\nOur staff will be with you soon.`,
          }],
        },
        ...adminComponents,
      ],
    };
  await ticketChannel.send(messagePayload);

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

function getRuntimeTicketType(guildId, ticketRecord) {
  return findTicketType(guildId, ticketRecord?.ticketTypeId) || ticketRecord?.ticketTypeSnapshot || null;
}

async function sendConfiguredTranscript(interaction, channel, ticketRecord, ticketType, closeAnswers = []) {
  if (!ticketType.transcriptEnabled) return null;
  const transcriptPath = await saveTranscript(channel, {
    ticketRecord,
    closedBy: interaction.user.id,
    closeAction: 'configured_admin_action',
  });
  if (closeAnswers.length) {
    const answerText = formatFormAnswers(closeAnswers);
    if (answerText) fs.appendFileSync(transcriptPath, `\nClosing form\n\n${answerText}\n`, 'utf8');
  }
  const guildConfig = getTicketConfig(interaction.guildId);
  const transcriptChannelId = ticketType.transcriptChannelId || resolveLoggingChannelId(guildConfig, 'transcripts', '', guildConfig.channels.transcript || TRANSCRIPT_CHANNEL_ID);
  const transcriptChannel = await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null);
  if (transcriptChannel?.isTextBased()) {
    await transcriptChannel.send({
      content: `Transcript for #${channel.name} (${channel.id})`,
      files: [transcriptPath],
    }).catch(() => null);
  }
  return transcriptPath;
}

async function disableConfiguredAdminMessage(interaction) {
  const message = interaction.message;
  if (!message?.editable) return;
  const components = message.components.map((component) => component.toJSON());
  for (const component of components) {
    if (component.type !== 1 || !Array.isArray(component.components)) continue;
    for (const child of component.components) {
      if ([2, 3].includes(child.type)) child.disabled = true;
    }
  }
  await message.edit({ components }).catch(() => null);
}

async function executeConfiguredAdminActions(interaction, channelId, controlId, closeAnswers = [], controlOverride = null) {
  const state = loadState();
  const ticketRecord = state.tickets[channelId];
  if (!ticketRecord) {
    await interaction.reply({ content: 'This ticket record is missing.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const ticketType = getRuntimeTicketType(interaction.guildId, ticketRecord);
  const control = controlOverride || ticketType?.adminPanel?.controls?.find((item) => item.id === controlId);
  if (!ticketType || !control) {
    await interaction.reply({ content: 'This ticket action is no longer configured.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!canUseStaffActions(interaction.member, ticketType)) {
    await interaction.reply({ content: 'Only configured ticket staff can use this action.', flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  const channel = interaction.guild.channels.cache.get(channelId)
    || await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await interaction.editReply({ content: 'The ticket channel is unavailable.' }).catch(() => null);
    return true;
  }

  const actions = orderAdminActions(control.actions);
  const completed = [];
  let shouldDelete = false;
  for (const action of actions) {
    if (action === 'close') {
      const ticketOwner = await interaction.guild.members.fetch(ticketRecord.userId).catch(() => null);
      if (ticketOwner) {
        await channel.permissionOverwrites.edit(ticketOwner.id, {
          ViewChannel: false,
          SendMessages: false,
        }).catch(() => null);
      }
      ticketRecord.closed = true;
      ticketRecord.closedAt = new Date().toISOString();
      ticketRecord.closedBy = interaction.user.id;
      ticketRecord.closeQuestionAnswerPairs = closeAnswers;
      completed.push('closed');
    } else if (action === 'blacklist') {
      const ticketOwner = await interaction.guild.members.fetch(ticketRecord.userId).catch(() => null);
      const roleAdded = ticketType.blacklistRoleId && ticketOwner
        ? await ticketOwner.roles.add(ticketType.blacklistRoleId, 'Ticket system blacklist action').then(() => true).catch(() => false)
        : false;
      if (!roleAdded) {
        const list = state.blacklistedUsersByGuild[interaction.guildId] ?? [];
        if (!list.includes(ticketRecord.userId)) list.push(ticketRecord.userId);
        state.blacklistedUsersByGuild[interaction.guildId] = list;
      }
      completed.push('blacklisted');
    } else if (action === 'move_to') {
      const targetType = findTicketType(interaction.guildId, control.moveToTicketTypeId);
      if (targetType) {
        const targetCategoryId = targetType.categoryChannelId || getTicketConfig(interaction.guildId).channels.ticketCategory;
        if (targetCategoryId) await channel.setParent(targetCategoryId, { lockPermissions: false }).catch(() => null);
        await channel.setName(sanitizeChannelName(`${targetType.name}-${channel.id.slice(-4)}`)).catch(() => null);
        ticketRecord.ticketTypeId = targetType.id;
        ticketRecord.ticketType = targetType.name;
        ticketRecord.ticketTypeSnapshot = targetType;
        completed.push(`moved to ${targetType.name}`);
      }
    } else if (action === 'transcript') {
      const transcriptPath = await sendConfiguredTranscript(interaction, channel, ticketRecord, ticketType, closeAnswers);
      if (transcriptPath) completed.push('transcript saved');
    } else if (action === 'delete') {
      shouldDelete = true;
      completed.push('scheduled for deletion');
    }
  }

  state.tickets[channelId] = ticketRecord;
  saveState(state);
  if (ticketRecord.closed) await disableConfiguredAdminMessage(interaction);
  const summary = completed.length ? `Ticket ${completed.join(', ')}.` : 'No executable actions were configured.';
  await interaction.editReply({ content: summary }).catch(() => null);
  if (shouldDelete) {
    setTimeout(() => {
      channel.delete('Configured ticket action').catch(() => null);
    }, 3000);
  }
  return true;
}

async function openConfiguredTicketType(interaction, ticketTypeId) {
  const ticketType = findTicketType(interaction.guildId, ticketTypeId);
  if (!ticketType) {
    await interaction.reply({ content: 'This ticket type is no longer available.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.isStringSelectMenu()) await resetPanelTypeSelection(interaction);
  const createQuestions = ticketType.forms?.enabled ? ticketType.forms.create || [] : [];
  if (createQuestions.length) {
    await interaction.showModal(getTicketFormModal(ticketType, 'create'));
    return true;
  }
  await createTicketChannel({
    interaction,
    ticketType,
    channelBaseName: ticketType.name,
    questionAnswerPairs: [],
  });
  return true;
}

async function submitConfiguredCrewRoleRequest(interaction, questionAnswerPairs) {
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  const game = questionAnswerPairs.find((entry) => entry.question.toLowerCase().includes('game'))?.answer || '-';
  const username = questionAnswerPairs.find((entry) => entry.question.toLowerCase().includes('username'))?.answer || '-';
  const uploadedEvidence = questionAnswerPairs.flatMap((entry) => entry.uploadedFiles || []);
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

  const files = getUploadedEvidenceFiles(uploadedEvidence);
  const reviewChannelId = resolveLoggingChannelId(getTicketConfig(interaction.guildId), 'requests', 'role_review', ROLE_REQUEST_REVIEW_CHANNEL_ID);
  const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased()) {
    await interaction.editReply({ content: 'The role request review channel is unavailable.' }).catch(() => null);
    return true;
  }
  await reviewChannel.send({
    flags: COMPONENTS_V2_FLAG,
    ...(files.length ? { files } : {}),
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
  await interaction.editReply({ content: 'Your Crew Member+ role request has been submitted.' }).catch(() => null);
  return true;
}

async function handleConfiguredCreateForm(interaction) {
  const ticketTypeId = interaction.customId.slice(CUSTOM_IDS.createFormPrefix.length);
  const ticketType = findTicketType(interaction.guildId, ticketTypeId);
  if (!ticketType) {
    await interaction.reply({ content: 'This ticket type is no longer available.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const answers = ticketFormAnswers(interaction, ticketType.forms?.create || []);
  if (ticketType.workflow === 'request_role_crew_member_plus') {
    return submitConfiguredCrewRoleRequest(interaction, answers);
  }
  await createTicketChannel({
    interaction,
    ticketType,
    channelBaseName: ticketType.name,
    questionAnswerPairs: answers,
  });
  return true;
}

async function handleConfiguredAdminInteraction(interaction) {
  let channelId = '';
  let controlId = '';
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(CUSTOM_IDS.adminSelectPrefix)) {
    channelId = interaction.customId.slice(CUSTOM_IDS.adminSelectPrefix.length);
    [controlId] = interaction.values;
  } else if (interaction.isButton() && interaction.customId.startsWith(CUSTOM_IDS.adminButtonPrefix)) {
    const value = interaction.customId.slice(CUSTOM_IDS.adminButtonPrefix.length);
    [channelId, controlId] = value.split(':');
  } else {
    return false;
  }

  const state = loadState();
  const ticketRecord = state.tickets[channelId];
  const ticketType = getRuntimeTicketType(interaction.guildId, ticketRecord);
  const control = ticketType?.adminPanel?.controls?.find((item) => item.id === controlId);
  if (!ticketRecord || !ticketType || !control) {
    await interaction.reply({ content: 'This ticket action is unavailable.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!canUseStaffActions(interaction.member, ticketType)) {
    await interaction.reply({ content: 'Only configured ticket staff can use this action.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (orderAdminActions(control.actions).includes('close') && ticketType.forms?.enabled && ticketType.forms.close?.length) {
    await interaction.showModal(getTicketFormModal(ticketType, 'close', channelId, controlId));
    return true;
  }
  return executeConfiguredAdminActions(interaction, channelId, controlId);
}

async function handleConfiguredCloseForm(interaction) {
  const value = interaction.customId.slice(CUSTOM_IDS.closeFormPrefix.length);
  const [channelId, controlId] = value.split(':');
  const state = loadState();
  const ticketRecord = state.tickets[channelId];
  const ticketType = getRuntimeTicketType(interaction.guildId, ticketRecord);
  if (!ticketType) {
    await interaction.reply({ content: 'This ticket type is unavailable.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const answers = ticketFormAnswers(interaction, ticketType.forms?.close || []);
  const commandAction = controlId.startsWith('command-') ? controlId.slice('command-'.length) : '';
  const controlOverride = commandAction
    ? {
      id: controlId,
      actions: [commandAction],
      moveToTicketTypeId: '',
    }
    : null;
  return executeConfiguredAdminActions(interaction, channelId, controlId, answers, controlOverride);
}

async function executeTicketCommandAction(interaction, action, moveToTicketTypeId = '') {
  const state = loadState();
  const ticketRecord = state.tickets[interaction.channelId];
  const ticketType = getRuntimeTicketType(interaction.guildId, ticketRecord);
  if (!ticketRecord || !ticketType) {
    await interaction.reply({ content: 'Use this command inside a configured ticket channel.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!canUseStaffActions(interaction.member, ticketType)) {
    await interaction.reply({ content: 'Only configured ticket staff can use this command.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === 'move_to' && !findTicketType(interaction.guildId, moveToTicketTypeId)) {
    await interaction.reply({ content: 'Choose a valid destination ticket type.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const control = {
    id: `command-${action}`,
    actions: [action],
    moveToTicketTypeId,
  };
  if (action === 'close' && ticketType.forms?.enabled && ticketType.forms.close?.length) {
    await interaction.showModal(getTicketFormModal(ticketType, 'close', interaction.channelId, control.id));
    return true;
  }
  return executeConfiguredAdminActions(interaction, interaction.channelId, control.id, [], control);
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
  const transcriptChannelId = resolveLoggingChannelId(getTicketConfig(interaction.guildId), 'transcripts', '', TRANSCRIPT_CHANNEL_ID);
  const transcriptChannel = await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null);
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
    await member.roles.add(getCrewMemberPlusRoleIdForGame(request.game, interaction.guildId)).catch(() => null);
    await member
      .send(
        container(
          0x00ff00,
          'Your **Request Join Guild** ticket has been accepted!'
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

  async refreshGuild(guild, clientUserId) {
    await ensurePanelMessage(guild, clientUserId);
  },

  async executeTicketAction(interaction, action, moveToTicketTypeId = '') {
    return executeTicketCommandAction(interaction, action, moveToTicketTypeId);
  },

  getTicketTypeChoices(guildId) {
    return getTicketTypes(guildId).map((ticketType) => ({ name: ticketType.name, value: ticketType.id }));
  },

  async handleInteraction(interaction) {
    if (!interaction.guildId) {
      return false;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === CUSTOM_IDS.panelTypeSelect) {
      return openConfiguredTicketType(interaction, interaction.values[0]);
    }

    if (interaction.isButton() && interaction.customId.startsWith(CUSTOM_IDS.panelTypeButtonPrefix)) {
      return openConfiguredTicketType(interaction, interaction.customId.slice(CUSTOM_IDS.panelTypeButtonPrefix.length));
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(CUSTOM_IDS.createFormPrefix)) {
      return handleConfiguredCreateForm(interaction);
    }

    if (
      (interaction.isStringSelectMenu() && interaction.customId.startsWith(CUSTOM_IDS.adminSelectPrefix))
      || (interaction.isButton() && interaction.customId.startsWith(CUSTOM_IDS.adminButtonPrefix))
    ) {
      return handleConfiguredAdminInteraction(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(CUSTOM_IDS.closeFormPrefix)) {
      return handleConfiguredCloseForm(interaction);
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

      const files = getUploadedEvidenceFiles(uploadedEvidence);

      const reviewChannelId = resolveLoggingChannelId(getTicketConfig(interaction.guildId), 'requests', 'role_review', ROLE_REQUEST_REVIEW_CHANNEL_ID);
      const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
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
        ...(files.length ? { files } : {}),
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
          getGiveawayReviewActionRow(`${CUSTOM_IDS.giveawayReviewSelectPrefix}${requestId}`, true, interaction.guildId),
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

      const claimEvidence = getUploadedAttachmentDetails(interaction, CUSTOM_IDS.giveawayClaimEvidenceUpload);
      if (claimEvidence.length === 0) {
        await interaction.reply({ content: 'Please upload at least one proof file.', flags: MessageFlags.Ephemeral });
        return true;
      }

      request.status = 'claimed';
      request.claimedEvidence = claimEvidence;
      state.giveawayRequests[requestId] = request;
      saveState(state);

      const reviewChannelId = resolveLoggingChannelId(getTicketConfig(interaction.guildId), 'requests', 'giveaway_review', GIVEAWAY_REQUEST_REVIEW_CHANNEL_ID);
      const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
      if (reviewChannel?.isTextBased()) {
        const files = getUploadedEvidenceFiles(claimEvidence);

        await reviewChannel.send({
          content: `Claim proof for <@${request.userId}>'s giveaway request (${requestId})`,
          ...(files.length ? { files } : {}),
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


// Consolidated command runtime fixes. These execute with their original virtual
// filenames so relative imports and module hooks retain their established behavior.
;(function installConsolidatedCommandFixes() {
  const ConsolidatedFixModule = require('module');
  const fixes = [
    ["00-message-template-interactions.js", function (module, exports, require, __filename, __dirname) {
const Module = require('module');
const { handleMessageTemplateInteraction } = require('../src/messageTemplates');
const { fitMessageThumbnailSquares } = require('../src/thumbnailFit');

const previousLoad = Module._load;

function wrapThumbnailReplies(interaction) {
  if (!interaction || interaction.__coinSpriteThumbnailRepliesWrapped) return;
  interaction.__coinSpriteThumbnailRepliesWrapped = true;
  for (const method of ['reply', 'followUp']) {
    if (typeof interaction[method] !== 'function') continue;
    const nativeMethod = interaction[method].bind(interaction);
    interaction[method] = async (payload, ...args) => nativeMethod(await fitMessageThumbnailSquares(payload), ...args);
  }
}

Module._load = function registerMessageTemplateInteractions(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__messageTemplateInteractionCapture) return exported;

  const nativeInit = exported.init?.bind(exported);
  exported.init = async (client) => {
    if (!client.__messageTemplateInteractionHandler) {
      client.__messageTemplateInteractionHandler = true;
      client.on('interactionCreate', (interaction) => {
        wrapThumbnailReplies(interaction);
        handleMessageTemplateInteraction(interaction).catch((error) => {
          console.error('Message template component interaction failed:', error);
        });
      });
    }
    if (nativeInit) await nativeInit(client);
  };
  exported.__messageTemplateInteractionCapture = true;
  return exported;
};

module.exports = {};
    }],
    ["00-request-ticket-patch.js", function (module, exports, require, __filename, __dirname) {
const Module = require('module');
const {
  ActionRowBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig, resolveLoggingChannelId } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, discordEmoji, formatFormAnswers } = require('../src/ticketConfig');

const originalLoad = Module._load;
const ACTION_MAP = Object.freeze({ close: 'accept', delete: 'deny', transcript: 'dm', move_to: 'role_add', blacklist: 'blacklist' });
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

function isRequestType(type) {
  return Boolean(type && String(type.id || '').startsWith('request-'));
}

function ticketType(guildId, id) {
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === id) || null;
}

function submittedComponent(value, customId) {
  if (!value || typeof value !== 'object') return null;
  if (value.customId === customId || value.custom_id === customId) return value;
  for (const child of value.components || []) {
    const found = submittedComponent(child, customId);
    if (found) return found;
  }
  return null;
}

function attachmentUrl(interaction, id) {
  const resolved = interaction?.data?.resolved?.attachments || interaction?.resolved?.attachments;
  const attachment = typeof resolved?.get === 'function' ? resolved.get(id) : resolved?.[id];
  return attachment?.url || attachment?.proxyURL || attachment?.proxy_url || id;
}

function formAnswers(interaction, questions) {
  return (questions || []).filter((question) => question.type !== 'text_display').map((question, index) => {
    let answer = '';
    try { answer = interaction.fields.getTextInputValue(question.id); } catch { /* Components V2 fields are read below. */ }
    if (!answer) {
      const component = submittedComponent(interaction, question.id);
      const values = component?.values || (component?.value !== undefined ? [component.value] : []);
      answer = (Array.isArray(values) ? values : [values])
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map((value) => question.type === 'file_upload' ? attachmentUrl(interaction, value) : String(value))
        .join(', ');
    }
    return { order: question.order || index + 1, question: question.question, type: question.type, answer };
  });
}

function buttonStyle(style) {
  return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2;
}

function decodedActions(control) {
  return [...new Set((control.actions || []).map((action) => ACTION_MAP[action]).filter(Boolean))];
}

function requestComponents(type, requestId, disabled = false) {
  if (type.adminPanel?.enabled === false) return [];
  const controls = (type.adminPanel?.controls || []).filter((control) => !control.url && decodedActions(control).length);
  const rows = [];
  for (let index = 0; index < controls.length; index += 5) {
    rows.push({
      type: 1,
      components: controls.slice(index, index + 5).map((control) => ({
        type: 2,
        custom_id: `request:act:${requestId}:${control.id}`,
        label: String(control.name || 'Action').slice(0, 80),
        style: buttonStyle(control.buttonStyle),
        disabled,
        ...(control.emoji ? { emoji: discordEmoji(control.emoji) } : {}),
      })),
    });
  }
  return rows;
}

function requestContext(interaction, type, requestId, answers) {
  return {
    mention: `<@${interaction.user.id}>`,
    username: interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    userId: interaction.user.id,
    ticketName: type.name,
    ticketId: requestId,
    channel: interaction.channel ? `<#${interaction.channel.id}>` : '',
    server: interaction.guild?.name || '',
    avatarUrl: interaction.user.displayAvatarURL(),
    formAnswers: formatFormAnswers(answers),
  };
}

function storedContext(guild, request) {
  return {
    mention: `<@${request.userId}>`, username: request.username, displayName: request.displayName,
    userId: request.userId, ticketName: request.type.name, ticketId: request.id,
    channel: request.reviewChannelId ? `<#${request.reviewChannelId}>` : '', server: guild.name,
    avatarUrl: request.avatarUrl, formAnswers: formatFormAnswers(request.answers),
  };
}

function statusMessage(type, status, reason) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const suffix = reason ? `\n-# Reason: ${reason}` : '';
  return { ...type.message, content: `${type.message?.content || ''}\n<separator>\n**Status: ${label}**${suffix}`.trim() };
}

async function submitRequest(interaction, type, answers) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: EPHEMERAL });
  const config = getGuildConfig(interaction.guildId);
  const state = loadState();
  state.roleRequests ||= {};
  const blacklist = new Set(state.blacklistedUsersByGuild?.[interaction.guildId] || []);
  if (blacklist.has(interaction.user.id)) {
    await interaction.editReply({ content: 'You are not allowed to create this request.' });
    return true;
  }
  const reviewChannelId = type.transcriptChannelId || resolveLoggingChannelId(config, 'requests', 'role_review', config.channels?.roleRequestReview);
  const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased()) {
    await interaction.editReply({ content: 'The request review channel is unavailable. Ask an administrator to configure it.' });
    return true;
  }
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const request = {
    requestKind: 'configurable', id, guildId: interaction.guildId, userId: interaction.user.id,
    username: interaction.user.username, displayName: interaction.member?.displayName || interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL(), type, answers, status: 'pending',
    reviewChannelId, createdAt: new Date().toISOString(),
  };
  const payload = buildTicketMessagePayload(type.message, requestContext(interaction, type, id, answers), requestComponents(type, id));
  const message = await reviewChannel.send(payload);
  request.reviewMessageId = message.id;
  state.roleRequests[id] = request;
  saveState(state);
  await interaction.editReply({ content: `Your ${type.name} request has been submitted.` });
  return true;
}

function canInteract(interaction, type) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (!(type.authorPermissions || []).includes('UseApplicationCommands')) return false;
  const config = getGuildConfig(interaction.guildId);
  const allowed = new Set(type.staffRoleIds?.length ? type.staffRoleIds : [config.roles?.staff].filter(Boolean));
  return interaction.member?.roles?.cache?.some((role) => allowed.has(role.id)) || false;
}

function reasonModal(requestId, control) {
  return new ModalBuilder()
    .setCustomId(`request:reason:${requestId}:${control.id}`)
    .setTitle(`${control.name || 'Request action'} reason`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000),
    ));
}

async function runActions(interaction, request, control, reason = '') {
  const actions = decodedActions(control);
  const guild = interaction.guild;
  const member = await guild.members.fetch(request.userId).catch(() => null);
  const state = loadState();
  const type = request.type;
  let terminal = '';
  for (const action of actions) {
    if (action === 'accept') terminal = 'accepted';
    if (action === 'deny') terminal = 'denied';
    if (action === 'dm' && member) {
      const text = String(control.description || `Your ${type.name} request was reviewed.`)
        .replace(/<reason>/gi, reason).replace(/<ticket_name>/gi, type.name);
      await member.send(text).catch(() => null);
    }
    if (action === 'role_add' && member && /^\d{16,20}$/.test(control.moveToTicketTypeId || '')) {
      await member.roles.add(control.moveToTicketTypeId).catch(() => null);
    }
    if (action === 'blacklist') {
      state.blacklistedUsersByGuild ||= {};
      const values = new Set(state.blacklistedUsersByGuild[interaction.guildId] || []);
      values.add(request.userId);
      state.blacklistedUsersByGuild[interaction.guildId] = [...values];
      if (member && type.blacklistRoleId) await member.roles.add(type.blacklistRoleId).catch(() => null);
      terminal ||= 'blacklisted';
    }
  }
  request.status = terminal || 'processed';
  request.reason = reason;
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests[request.id] = request;
  saveState(state);
  const payload = buildTicketMessagePayload(statusMessage(type, request.status, reason), storedContext(guild, request), requestComponents(type, request.id, true));
  if (interaction.isModalSubmit()) await interaction.update(payload);
  else await interaction.update(payload);
  if (member && terminal === 'accepted') await member.send(`Your **${type.name}** request was accepted.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
  if (member && terminal === 'denied') await member.send(`Your **${type.name}** request was denied.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
  return true;
}

async function handleRequestInteraction(interaction) {
  if (!interaction.guildId) return false;
  let typeId = '';
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:type-select') typeId = interaction.values[0];
  if (interaction.isButton() && interaction.customId.startsWith('ticket:type-button:')) typeId = interaction.customId.slice('ticket:type-button:'.length);
  if (typeId) {
    const type = ticketType(interaction.guildId, typeId);
    if (!isRequestType(type)) return false;
    const questions = type.forms?.enabled ? type.forms.create || [] : [];
    if (questions.length) return false;
    return submitRequest(interaction, type, []);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:create-form:')) {
    const type = ticketType(interaction.guildId, interaction.customId.slice('ticket:create-form:'.length));
    if (!isRequestType(type)) return false;
    return submitRequest(interaction, type, formAnswers(interaction, type.forms?.create || []));
  }
  if (interaction.isButton() && interaction.customId.startsWith('request:act:')) {
    const [, , requestId, controlId] = interaction.customId.split(':');
    const request = loadState().roleRequests?.[requestId];
    if (!request?.requestKind) return false;
    if (!canInteract(interaction, request.type)) {
      await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
      return true;
    }
    if (request.status !== 'pending') {
      await interaction.reply({ content: 'This request has already been handled.', flags: EPHEMERAL });
      return true;
    }
    const control = request.type.adminPanel?.controls?.find((item) => item.id === controlId);
    if (!control) return false;
    const needsReason = String(control.id).startsWith('reason-') && decodedActions(control).some((action) => ['accept', 'deny', 'blacklist'].includes(action));
    if (needsReason) {
      await interaction.showModal(reasonModal(requestId, control));
      return true;
    }
    return runActions(interaction, request, control);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('request:reason:')) {
    const [, , requestId, controlId] = interaction.customId.split(':');
    const request = loadState().roleRequests?.[requestId];
    const control = request?.type?.adminPanel?.controls?.find((item) => item.id === controlId);
    if (!request || !control) return false;
    if (!canInteract(interaction, request.type)) {
      await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
      return true;
    }
    return runActions(interaction, request, control, interaction.fields.getTextInputValue('reason'));
  }
  return false;
}

Module._load = function patchedLoad(request, parent, isMain) {
  const exported = originalLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestTicketPatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleRequestInteraction(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestTicketPatched = true;
  return exported;
};
    }],
    ["03-request-workflows.js", function (module, exports, require, __filename, __dirname) {
const Module = require('module');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildConfig } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, discordEmoji, formatFormAnswers } = require('../src/ticketConfig');
const { findTemplate, buildMessagePayload } = require('../src/messageTemplates');
const { getUserProgress } = require('../src/levelingManager');
const { getControlWorkflow } = require('../src/requestControlWorkflows');

const originalLoad = Module._load;
const ACTION_MAP = Object.freeze({ close: 'accept', delete: 'deny', transcript: 'dm_template', move_to: 'role_add', blacklist: 'blacklist' });
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;

function decodedActions(control) {
  return [...new Set((control.actions || []).map((action) => ACTION_MAP[action]).filter(Boolean))];
}
function conditionIdFromStep(value) {
  const match = String(value || '').match(/^condition_([a-z0-9_-]{1,32})$/);
  return match?.[1] || '';
}
function workflowSequence(control, workflow) {
  if (Array.isArray(workflow?.sequence) && workflow.sequence.length) return workflow.sequence;
  return [
    ...(control.actions || []),
    ...(workflow?.conditions || []).map((condition) => `condition_${condition.id}`),
  ];
}
function buttonStyle(style) {
  return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2;
}
function currentRequestType(guildId, request) {
  const typeId = request?.type?.id || request?.ticketTypeId || '';
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === typeId)
    || request?.type
    || null;
}
function requestComponents(type, requestId, disabled = false) {
  if (type.adminPanel?.enabled === false) return [];
  const controls = (type.adminPanel?.controls || []).filter((control) => !control.url && decodedActions(control).length);
  const rows = [];
  for (let index = 0; index < controls.length; index += 5) {
    rows.push({
      type: 1,
      components: controls.slice(index, index + 5).map((control) => {
        const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
        return {
          type: 2,
          custom_id: `request:act:${requestId}:${control.id}`,
          label: String(control.name || 'Action').slice(0, 80),
          style: buttonStyle(control.buttonStyle),
          disabled,
          ...(emoji ? { emoji } : {}),
        };
      }),
    });
  }
  return rows;
}
function storedContext(guild, request, type) {
  return {
    mention: `<@${request.userId}>`, username: request.username, displayName: request.displayName,
    userId: request.userId, ticketName: type.name, ticketId: request.id,
    channel: request.reviewChannelId ? `<#${request.reviewChannelId}>` : '', server: guild.name,
    avatarUrl: request.avatarUrl, formAnswers: formatFormAnswers(request.answers),
  };
}
function statusMessage(type, status, reason) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const suffix = reason ? `\n-# Reason: ${reason}` : '';
  return { ...type.message, content: `${type.message?.content || ''}\n<separator>\n**Status: ${label}**${suffix}`.trim() };
}
function canInteract(interaction, type) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (!(type.authorPermissions || []).includes('UseApplicationCommands')) return false;
  const config = getGuildConfig(interaction.guildId);
  const allowed = new Set(type.staffRoleIds?.length ? type.staffRoleIds : [config.roles?.staff].filter(Boolean));
  return interaction.member?.roles?.cache?.some((role) => allowed.has(role.id)) || false;
}
function answerForCondition(request, condition) {
  const question = (request.type.forms?.create || []).find((item) => item.id === condition.questionId);
  if (!question) return { question: null, answer: '' };
  const answer = (request.answers || []).find((item) => Number(item.order) === Number(question.order));
  return { question, answer: String(answer?.answer || '').trim() };
}
function matchesFormCondition(request, condition) {
  const { question, answer } = answerForCondition(request, condition);
  if (!question) return false;
  if (question.type === 'file_upload') {
    if (!['has_files', 'no_files'].includes(condition.expected)) return false;
    return condition.expected === 'has_files' ? Boolean(answer) : !answer;
  }
  if (question.type === 'checkbox') {
    if (!['checked', 'not_checked'].includes(condition.expected)) return false;
    const checked = ['true', '1', 'yes', 'on', 'checked'].includes(answer.toLowerCase());
    return condition.expected === 'checked' ? checked : !checked;
  }
  if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) {
    const expected = String(condition.expected || '').trim();
    return Boolean(expected) && answer.split(',').map((value) => value.trim()).includes(expected);
  }
  return answer.toLowerCase() === String(condition.expected || '').trim().toLowerCase();
}
function matchesCondition(request, condition, member) {
  if (condition.type === 'form_input') return matchesFormCondition(request, condition);
  if (condition.type === 'has_role') return Boolean(condition.roleId && member?.roles?.cache?.has(condition.roleId));
  if (condition.type === 'level') return getUserProgress(request.guildId, request.userId).level >= Number(condition.level || 0);
  return false;
}
async function sendTemplate(member, guildId, templateId) {
  if (!member || !templateId) return;
  const template = findTemplate(guildId, templateId);
  if (template) await member.send(buildMessagePayload(template)).catch(() => null);
}
async function executeAction(action, context) {
  const { member, request, state, type } = context;
  if (action.type === 'dm_template') await sendTemplate(member, request.guildId, action.templateId);
  if (action.type === 'role_add' && member && action.roleId) await member.roles.add(action.roleId).catch(() => null);
  if (action.type === 'accept') context.terminal = 'accepted';
  if (action.type === 'deny') context.terminal = 'denied';
  if (action.type === 'blacklist') {
    state.blacklistedUsersByGuild ||= {};
    const values = new Set(state.blacklistedUsersByGuild[request.guildId] || []);
    values.add(request.userId);
    state.blacklistedUsersByGuild[request.guildId] = [...values];
    if (member && type.blacklistRoleId) await member.roles.add(type.blacklistRoleId).catch(() => null);
    context.terminal ||= 'blacklisted';
  }
}
async function runWorkflow(interaction, request, type, control, workflow) {
  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  const state = loadState();
  const requestForConditions = { ...request, type };
  const context = { member, request, state, type, terminal: '' };
  const conditions = new Map((workflow.conditions || []).map((condition) => [condition.id, condition]));
  for (const step of workflowSequence(control, workflow)) {
    const conditionId = conditionIdFromStep(step);
    if (conditionId) {
      const condition = conditions.get(conditionId);
      if (condition && matchesCondition(requestForConditions, condition, member)) {
        for (const action of condition.actions || []) await executeAction(action, context);
      }
      continue;
    }
    const actionType = ACTION_MAP[step];
    if (actionType === 'dm_template') await sendTemplate(member, request.guildId, workflow.dmTemplateId);
    else if (actionType === 'role_add') await executeAction({ type: 'role_add', roleId: control.moveToTicketTypeId }, context);
    else if (actionType) await executeAction({ type: actionType }, context);
  }
  request.type = type;
  request.status = context.terminal || 'processed';
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests[request.id] = request;
  saveState(state);
  const payload = buildTicketMessagePayload(
    statusMessage(type, request.status, ''),
    storedContext(interaction.guild, request, type),
    requestComponents(type, request.id, true),
  );
  await interaction.update(payload);
  return true;
}
async function handleWorkflowInteraction(interaction) {
  if (!interaction.guildId || !interaction.isButton?.() || !interaction.customId.startsWith('request:act:')) return false;
  const [, , requestId, controlId] = interaction.customId.split(':');
  const request = loadState().roleRequests?.[requestId];
  const type = request ? currentRequestType(interaction.guildId, request) : null;
  const control = type?.adminPanel?.controls?.find((item) => item.id === controlId);
  const workflow = type ? getControlWorkflow(interaction.guildId, type.id, controlId) : null;
  if (!request || !type || !control || !workflow || (!workflow.dmTemplateId && !(workflow.conditions || []).length && !(workflow.sequence || []).length)) return false;
  if (!canInteract(interaction, type)) {
    await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
    return true;
  }
  if (request.status !== 'pending') {
    await interaction.reply({ content: 'This request has already been handled.', flags: EPHEMERAL });
    return true;
  }
  return runWorkflow(interaction, request, type, control, workflow);
}

Module._load = function patchedLoad(request, parent, isMain) {
  const exported = originalLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestWorkflowPatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleWorkflowInteraction(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestWorkflowPatched = true;
  return exported;
};

module.exports = { __test: { currentRequestType, matchesFormCondition, workflowSequence } };
    }],
    ["05-request-select-panel-fix.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const Module = require('module');
const {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getGuildConfig, resolveLoggingChannelId } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, discordEmoji, formatFormAnswers } = require('../src/ticketConfig');
const { findTemplate, buildMessagePayload } = require('../src/messageTemplates');
const { getUserProgress } = require('../src/levelingManager');
const { getControlWorkflow } = require('../src/requestControlWorkflows');

const previousLoad = Module._load;
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const ACTION_MAP = Object.freeze({ close: 'accept', delete: 'deny', transcript: 'dm_template', move_to: 'role_add', blacklist: 'blacklist' });
const PANEL_TYPE_SELECT = 'ticket:type-select';
const PANEL_TYPE_BUTTON_PREFIX = 'ticket:type-button:';

function isRequestType(type) {
  return Boolean(type && (String(type.id || '').startsWith('request-') || type.workflow === 'request_role_crew_member_plus'));
}
function configuredType(guildId, id) {
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === id) || null;
}
function currentRequestType(guildId, request) {
  const typeId = request?.type?.id || request?.ticketTypeId || '';
  return configuredType(guildId, typeId) || request?.type || null;
}
function decodedActions(control) {
  return [...new Set((control?.actions || []).map((action) => ACTION_MAP[action]).filter(Boolean))];
}
function buttonStyle(style) {
  return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2;
}
function panelTypeControls(ticketConfig) {
  if (!ticketConfig?.enabled) return [];
  const types = Array.isArray(ticketConfig.types) ? ticketConfig.types : [];
  if (!types.length) return [];
  if (ticketConfig.launcherStyle === 'buttons') {
    const rows = [];
    for (let index = 0; index < types.length; index += 5) {
      rows.push({
        type: 1,
        components: types.slice(index, index + 5).map((ticketType) => ({
          type: 2,
          custom_id: `${PANEL_TYPE_BUTTON_PREFIX}${ticketType.id}`,
          label: ticketType.name,
          style: buttonStyle(ticketType.buttonStyle),
          ...(ticketType.emoji ? { emoji: discordEmoji(ticketType.emoji) } : {}),
        })),
      });
    }
    return rows;
  }
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: PANEL_TYPE_SELECT,
      placeholder: 'Choose a ticket type',
      options: types.map((ticketType) => ({
        label: ticketType.name,
        value: ticketType.id,
        ...(ticketType.description ? { description: ticketType.description } : {}),
        ...(ticketType.emoji ? { emoji: discordEmoji(ticketType.emoji) } : {}),
      })),
    }],
  }];
}
function ticketPanelPayload(interaction) {
  const ticketConfig = getGuildConfig(interaction.guildId)?.tickets;
  return buildTicketMessagePayload(
    ticketConfig?.launcherMessage,
    { server: interaction.guild?.name || '' },
    panelTypeControls(ticketConfig),
  );
}
async function resetTicketTypeSelection(interaction) {
  if (!interaction?.isStringSelectMenu?.() || interaction.customId !== PANEL_TYPE_SELECT || !interaction.message?.editable || !interaction.guildId) return;
  await interaction.message.edit(ticketPanelPayload(interaction)).catch(() => null);
}
function requestButton(control, requestId, disabled = false) {
  const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
  return {
    type: 2,
    custom_id: `request:act:${requestId}:${control.id}`,
    label: String(control.name || 'Action').slice(0, 80),
    style: buttonStyle(control.buttonStyle),
    disabled,
    ...(emoji ? { emoji } : {}),
  };
}
function requestOption(control) {
  const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
  return {
    label: String(control.name || 'Action').slice(0, 100),
    value: String(control.id || '').slice(0, 100),
    ...(control.description ? { description: String(control.description).slice(0, 100) } : {}),
    ...(emoji ? { emoji } : {}),
  };
}
function requestComponents(type, requestId, disabled = false) {
  if (type?.adminPanel?.enabled === false) return [];
  const controls = (type?.adminPanel?.controls || []).filter((control) => !control.url && decodedActions(control).length).slice(0, 25);
  if (!controls.length) return [];
  if (type.adminPanel?.style === 'buttons') {
    const rows = [];
    for (let index = 0; index < controls.length; index += 5) {
      rows.push({ type: 1, components: controls.slice(index, index + 5).map((control) => requestButton(control, requestId, disabled)) });
    }
    return rows;
  }
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: `request:act-select:${requestId}`,
      placeholder: disabled ? 'This request has been handled' : 'Choose request action',
      disabled,
      options: controls.map(requestOption),
    }],
  }];
}
function parseRequestAction(interaction) {
  const customId = interaction?.customId || '';
  if (interaction?.isButton?.() && customId.startsWith('request:act:')) {
    const [, , requestId, controlId] = customId.split(':');
    return { requestId, controlId };
  }
  if (interaction?.isStringSelectMenu?.() && customId.startsWith('request:act-select:')) {
    return { requestId: customId.slice('request:act-select:'.length), controlId: interaction.values?.[0] || '' };
  }
  return null;
}
function submittedComponent(value, customId) {
  if (!value || typeof value !== 'object') return null;
  if (value.customId === customId || value.custom_id === customId) return value;
  for (const child of value.components || []) {
    const found = submittedComponent(child, customId);
    if (found) return found;
  }
  return null;
}
function attachmentUrl(interaction, id) {
  const resolved = interaction?.data?.resolved?.attachments || interaction?.resolved?.attachments;
  const attachment = typeof resolved?.get === 'function' ? resolved.get(id) : resolved?.[id];
  return attachment?.url || attachment?.proxyURL || attachment?.proxy_url || id;
}
function formAnswers(interaction, questions) {
  return (questions || []).filter((question) => question.type !== 'text_display').map((question, index) => {
    let answer = '';
    try { answer = interaction.fields.getTextInputValue(question.id); } catch { /* Components V2 fields are read below. */ }
    if (!answer) {
      const component = submittedComponent(interaction, question.id);
      const values = component?.values || (component?.value !== undefined ? [component.value] : []);
      answer = (Array.isArray(values) ? values : [values])
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map((value) => question.type === 'file_upload' ? attachmentUrl(interaction, value) : String(value))
        .join(', ');
    }
    return { order: question.order || index + 1, question: question.question, type: question.type, answer };
  });
}
function requestContext(interaction, type, requestId, answers) {
  return {
    mention: `<@${interaction.user.id}>`,
    username: interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    userId: interaction.user.id,
    ticketName: type.name,
    ticketId: requestId,
    channel: interaction.channel ? `<#${interaction.channel.id}>` : '',
    server: interaction.guild?.name || '',
    avatarUrl: interaction.user.displayAvatarURL(),
    formAnswers: formatFormAnswers(answers),
  };
}
function storedContext(guild, request, type) {
  return {
    mention: `<@${request.userId}>`, username: request.username, displayName: request.displayName,
    userId: request.userId, ticketName: type.name, ticketId: request.id,
    channel: request.reviewChannelId ? `<#${request.reviewChannelId}>` : '', server: guild.name,
    avatarUrl: request.avatarUrl, formAnswers: formatFormAnswers(request.answers),
  };
}
function statusLabelFrom(value) {
  const text = String(value || '').trim();
  if (!text) return 'Processed';
  return /^[a-z_ -]+$/.test(text) ? text.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : text;
}
function selectedStatusLabel(control, fallback) {
  return statusLabelFrom(control?.name || fallback).slice(0, 80);
}
function statusMessage(type, statusLabel, reason = '') {
  const suffix = reason ? `\n-# Reason: ${reason}` : '';
  return { ...type.message, content: `${type.message?.content || ''}\n<separator>\n**Status: ${statusLabelFrom(statusLabel)}**${suffix}`.trim() };
}
function canInteract(interaction, type) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (!(type.authorPermissions || []).includes('UseApplicationCommands')) return false;
  const config = getGuildConfig(interaction.guildId);
  const allowed = new Set(type.staffRoleIds?.length ? type.staffRoleIds : [config.roles?.staff].filter(Boolean));
  return interaction.member?.roles?.cache?.some((role) => allowed.has(role.id)) || false;
}
function reasonModal(requestId, control) {
  return new ModalBuilder()
    .setCustomId(`request:reason:${requestId}:${control.id}`)
    .setTitle(`${control.name || 'Request action'} reason`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000),
    ));
}
async function sendTemplate(member, guildId, templateId) {
  if (!member || !templateId) return;
  const template = findTemplate(guildId, templateId);
  if (template) await member.send(buildMessagePayload(template)).catch(() => null);
}
function conditionIdFromStep(value) {
  return String(value || '').match(/^condition_([a-z0-9_-]{1,32})$/)?.[1] || '';
}
function workflowSequence(control, workflow) {
  if (Array.isArray(workflow?.sequence) && workflow.sequence.length) return workflow.sequence;
  return [
    ...(control.actions || []),
    ...(workflow?.conditions || []).map((condition) => `condition_${condition.id}`),
  ];
}
function answerForCondition(request, condition) {
  const question = (request.type.forms?.create || []).find((item) => item.id === condition.questionId);
  if (!question) return { question: null, answer: '' };
  const answer = (request.answers || []).find((item) => Number(item.order) === Number(question.order));
  return { question, answer: String(answer?.answer || '').trim() };
}
function matchesFormCondition(request, condition) {
  const { question, answer } = answerForCondition(request, condition);
  if (!question) return false;
  if (question.type === 'file_upload') return condition.expected === 'has_files' ? Boolean(answer) : !answer;
  if (question.type === 'checkbox') {
    const checked = ['true', '1', 'yes', 'on', 'checked'].includes(answer.toLowerCase());
    return condition.expected === 'checked' ? checked : !checked;
  }
  if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) {
    const expected = String(condition.expected || '').trim();
    return Boolean(expected) && answer.split(',').map((value) => value.trim()).includes(expected);
  }
  return answer.toLowerCase() === String(condition.expected || '').trim().toLowerCase();
}
function matchesCondition(request, condition, member) {
  if (condition.type === 'form_input') return matchesFormCondition(request, condition);
  if (condition.type === 'has_role') return Boolean(condition.roleId && member?.roles?.cache?.has(condition.roleId));
  if (condition.type === 'level') return getUserProgress(request.guildId, request.userId).level >= Number(condition.level || 0);
  return false;
}
async function executeWorkflowAction(action, context) {
  const { member, request, state, type } = context;
  if (action.type === 'dm_template') await sendTemplate(member, request.guildId, action.templateId);
  if (action.type === 'role_add' && member && action.roleId) await member.roles.add(action.roleId).catch(() => null);
  if (action.type === 'accept') context.terminal = 'accepted';
  if (action.type === 'deny') context.terminal = 'denied';
  if (action.type === 'blacklist') {
    state.blacklistedUsersByGuild ||= {};
    const values = new Set(state.blacklistedUsersByGuild[request.guildId] || []);
    values.add(request.userId);
    state.blacklistedUsersByGuild[request.guildId] = [...values];
    if (member && type.blacklistRoleId) await member.roles.add(type.blacklistRoleId).catch(() => null);
    context.terminal ||= 'blacklisted';
  }
}
async function runWorkflow(interaction, request, type, control, workflow) {
  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  const state = loadState();
  const requestForConditions = { ...request, type };
  const context = { member, request, state, type, terminal: '' };
  const conditions = new Map((workflow.conditions || []).map((condition) => [condition.id, condition]));
  for (const step of workflowSequence(control, workflow)) {
    const conditionId = conditionIdFromStep(step);
    if (conditionId) {
      const condition = conditions.get(conditionId);
      if (condition && matchesCondition(requestForConditions, condition, member)) {
        for (const action of condition.actions || []) await executeWorkflowAction(action, context);
      }
      continue;
    }
    const actionType = ACTION_MAP[step];
    if (actionType === 'dm_template') await sendTemplate(member, request.guildId, workflow.dmTemplateId);
    else if (actionType === 'role_add') await executeWorkflowAction({ type: 'role_add', roleId: control.moveToTicketTypeId }, context);
    else if (actionType) await executeWorkflowAction({ type: actionType }, context);
  }
  request.type = type;
  request.status = context.terminal || 'processed';
  request.statusLabel = selectedStatusLabel(control, request.status);
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests[request.id] = request;
  saveState(state);
  await interaction.update(buildTicketMessagePayload(statusMessage(type, request.statusLabel), storedContext(interaction.guild, request, type), requestComponents(type, request.id, true)));
  return true;
}
async function runSimpleActions(interaction, request, type, control, reason = '') {
  const actions = decodedActions(control);
  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  const state = loadState();
  let terminal = '';
  for (const action of actions) {
    if (action === 'accept') terminal = 'accepted';
    if (action === 'deny') terminal = 'denied';
    if (action === 'dm_template' && member) {
      const text = String(control.description || `Your ${type.name} request was reviewed.`).replace(/<reason>/gi, reason).replace(/<ticket_name>/gi, type.name);
      await member.send(text).catch(() => null);
    }
    if (action === 'role_add' && member && /^\d{16,20}$/.test(control.moveToTicketTypeId || '')) await member.roles.add(control.moveToTicketTypeId).catch(() => null);
    if (action === 'blacklist') {
      state.blacklistedUsersByGuild ||= {};
      const values = new Set(state.blacklistedUsersByGuild[request.guildId] || []);
      values.add(request.userId);
      state.blacklistedUsersByGuild[request.guildId] = [...values];
      if (member && type.blacklistRoleId) await member.roles.add(type.blacklistRoleId).catch(() => null);
      terminal ||= 'blacklisted';
    }
  }
  request.type = type;
  request.status = terminal || 'processed';
  request.statusLabel = selectedStatusLabel(control, request.status);
  request.reason = reason;
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests[request.id] = request;
  saveState(state);
  await interaction.update(buildTicketMessagePayload(statusMessage(type, request.statusLabel, reason), storedContext(interaction.guild, request, type), requestComponents(type, request.id, true)));
  if (member && terminal === 'accepted') await member.send(`Your **${type.name}** request was accepted.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
  if (member && terminal === 'denied') await member.send(`Your **${type.name}** request was denied.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
  return true;
}
async function submitRequest(interaction, type, answers) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: EPHEMERAL });
  const config = getGuildConfig(interaction.guildId);
  const state = loadState();
  state.roleRequests ||= {};
  if (new Set(state.blacklistedUsersByGuild?.[interaction.guildId] || []).has(interaction.user.id)) {
    await interaction.editReply({ content: 'You are not allowed to create this request.' });
    return true;
  }
  const reviewChannelId = type.transcriptChannelId || resolveLoggingChannelId(config, 'requests', 'role_review', config.channels?.roleRequestReview);
  const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased()) {
    await interaction.editReply({ content: 'The request review channel is unavailable. Ask an administrator to configure it.' });
    return true;
  }
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const request = {
    requestKind: 'configurable', id, guildId: interaction.guildId, userId: interaction.user.id,
    username: interaction.user.username, displayName: interaction.member?.displayName || interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL(), type, answers, status: 'pending', statusLabel: 'Pending',
    reviewChannelId, createdAt: new Date().toISOString(),
  };
  const message = await reviewChannel.send(buildTicketMessagePayload(type.message, requestContext(interaction, type, id, answers), requestComponents(type, id)));
  request.reviewMessageId = message.id;
  state.roleRequests[id] = request;
  saveState(state);
  await interaction.editReply({ content: `Your ${type.name} request has been submitted.` });
  return true;
}
function workflowIsExecutable(workflow) {
  return Boolean(workflow && (workflow.dmTemplateId || (workflow.conditions || []).length || (workflow.sequence || []).length));
}
async function handleRequestInteraction(interaction) {
  if (!interaction?.guildId) return false;
  let typeId = '';
  if (interaction.isStringSelectMenu?.() && interaction.customId === 'ticket:type-select') typeId = interaction.values?.[0] || '';
  if (interaction.isButton?.() && interaction.customId?.startsWith('ticket:type-button:')) typeId = interaction.customId.slice('ticket:type-button:'.length);
  if (typeId) {
    const type = configuredType(interaction.guildId, typeId);
    if (!isRequestType(type)) return false;
    const questions = type.forms?.enabled ? type.forms.create || [] : [];
    if (questions.length) return false;
    return submitRequest(interaction, type, []);
  }
  if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('ticket:create-form:')) {
    const type = configuredType(interaction.guildId, interaction.customId.slice('ticket:create-form:'.length));
    if (!isRequestType(type)) return false;
    return submitRequest(interaction, type, formAnswers(interaction, type.forms?.create || []));
  }
  if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('request:reason:')) {
    const [, , requestId, controlId] = interaction.customId.split(':');
    const request = loadState().roleRequests?.[requestId];
    const type = request ? currentRequestType(interaction.guildId, request) : null;
    const control = type?.adminPanel?.controls?.find((item) => item.id === controlId);
    if (!request || !type || !control) return false;
    if (!canInteract(interaction, type)) {
      await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
      return true;
    }
    return runSimpleActions(interaction, request, type, control, interaction.fields.getTextInputValue('reason'));
  }
  const selection = parseRequestAction(interaction);
  if (!selection) return false;
  const request = loadState().roleRequests?.[selection.requestId];
  const type = request ? currentRequestType(interaction.guildId, request) : null;
  const control = type?.adminPanel?.controls?.find((item) => item.id === selection.controlId);
  if (!request || !type || !control) return false;
  if (!canInteract(interaction, type)) {
    await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL });
    return true;
  }
  if (request.status !== 'pending') {
    await interaction.reply({ content: 'This request has already been handled.', flags: EPHEMERAL });
    return true;
  }
  const workflow = getControlWorkflow(interaction.guildId, type.id, control.id);
  if (workflowIsExecutable(workflow)) return runWorkflow(interaction, request, type, control, workflow);
  const needsReason = String(control.id).startsWith('reason-') && decodedActions(control).some((action) => ['accept', 'deny', 'blacklist'].includes(action));
  if (needsReason) {
    await interaction.showModal(reasonModal(request.id, control));
    return true;
  }
  return runSimpleActions(interaction, request, type, control);
}
Module._load = function requestSelectPanelPatch(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestSelectPanelPatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    const handledByRequestPatch = await handleRequestInteraction(interaction);
    if (handledByRequestPatch) {
      await resetTicketTypeSelection(interaction);
      return true;
    }
    const handled = await nativeHandle(interaction, client);
    if (handled) await resetTicketTypeSelection(interaction);
    return handled;
  };
  exported.__requestSelectPanelPatched = true;
  return exported;
};

module.exports = { __test: { requestComponents, selectedStatusLabel, workflowSequence } };
    }],
    ["07-request-dm-runtime.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const Module = require('module');
const {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getGuildConfig } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, discordEmoji, formatFormAnswers } = require('../src/ticketConfig');
const { findTemplate, buildMessagePayload } = require('../src/messageTemplates');
const { getControlWorkflow } = require('../src/requestControlWorkflows');
const { getUserProgress } = require('../src/levelingManager');

const previousLoad = Module._load;
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const ACTION_MAP = { close: 'accept', delete: 'deny', transcript: 'dm_template', move_to: 'role_add', blacklist: 'blacklist' };

function title(value, fallback = 'Processed') {
  const text = String(value || fallback).trim() || fallback;
  return /^[a-z_ -]+$/.test(text) ? text.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : text;
}
function actions(control) { return [...new Set((control?.actions || []).map((step) => ACTION_MAP[step]).filter(Boolean))]; }
function currentType(guildId, request) {
  const id = request?.type?.id || request?.ticketTypeId || '';
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === id) || request?.type || null;
}
function componentStyle(style) { return { primary: 1, secondary: 2, success: 3, danger: 4 }[style] || 2; }
function option(control) {
  const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
  return { label: String(control.name || 'Action').slice(0, 100), value: String(control.id || '').slice(0, 100), ...(control.description ? { description: String(control.description).slice(0, 100) } : {}), ...(emoji ? { emoji } : {}) };
}
function button(control, requestId, disabled) {
  const emoji = control.emoji ? discordEmoji(control.emoji) : undefined;
  return { type: 2, custom_id: `request:act:${requestId}:${control.id}`, label: String(control.name || 'Action').slice(0, 80), style: componentStyle(control.buttonStyle), disabled, ...(emoji ? { emoji } : {}) };
}
function requestComponents(type, requestId, disabled = false) {
  const controls = (type?.adminPanel?.controls || []).filter((control) => !control.url && actions(control).length).slice(0, 25);
  if (type?.adminPanel?.enabled === false || !controls.length) return [];
  if (type.adminPanel?.style === 'buttons') {
    const rows = [];
    for (let i = 0; i < controls.length; i += 5) rows.push({ type: 1, components: controls.slice(i, i + 5).map((control) => button(control, requestId, disabled)) });
    return rows;
  }
  return [{ type: 1, components: [{ type: 3, custom_id: `request:act-select:${requestId}`, placeholder: disabled ? 'This request has been handled' : 'Choose request action', disabled, options: controls.map(option) }] }];
}
function parseSelection(interaction) {
  const id = interaction?.customId || '';
  if (interaction?.isButton?.() && id.startsWith('request:act:')) {
    const [, , requestId, controlId] = id.split(':');
    return { requestId, controlId };
  }
  if (interaction?.isStringSelectMenu?.() && id.startsWith('request:act-select:')) return { requestId: id.slice('request:act-select:'.length), controlId: interaction.values?.[0] || '' };
  return null;
}
function canUse(interaction, type) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const staff = getGuildConfig(interaction.guildId)?.roles?.staff;
  const allowed = new Set(type?.staffRoleIds?.length ? type.staffRoleIds : [staff].filter(Boolean));
  return interaction.member?.roles?.cache?.some((role) => allowed.has(role.id)) || false;
}
function reasonModal(requestId, control) {
  return new ModalBuilder().setCustomId(`request:reason:${requestId}:${control.id}`).setTitle(`${control.name || 'Request action'} reason`.slice(0, 45)).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
  );
}
function stepConditionId(step) { return String(step || '').match(/^condition_([a-z0-9_-]{1,32})$/)?.[1] || ''; }
function sequence(control, workflow) { return Array.isArray(workflow?.sequence) && workflow.sequence.length ? workflow.sequence : [...(control?.actions || []), ...(workflow?.conditions || []).map((condition) => `condition_${condition.id}`)]; }
function workflowReady(workflow) { return Boolean(workflow && (workflow.dmTemplateId || (workflow.sequence || []).length || (workflow.conditions || []).length)); }
function answerFor(request, type, condition) {
  const question = (type.forms?.create || []).find((item) => item.id === condition.questionId);
  const answer = question ? (request.answers || []).find((item) => Number(item.order) === Number(question.order)) : null;
  return { question, answer: String(answer?.answer || '').trim() };
}
function matches(request, type, condition, member) {
  if (condition.type === 'has_role') return Boolean(condition.roleId && member?.roles?.cache?.has(condition.roleId));
  if (condition.type === 'level') return getUserProgress(request.guildId, request.userId).level >= Number(condition.level || 0);
  const { question, answer } = answerFor(request, type, condition);
  if (!question) return false;
  if (question.type === 'file_upload') return condition.expected === 'has_files' ? Boolean(answer) : !answer;
  if (question.type === 'checkbox') return (['true', '1', 'yes', 'on', 'checked'].includes(answer.toLowerCase())) === (condition.expected === 'checked');
  if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) return answer.split(',').map((value) => value.trim()).includes(String(condition.expected || '').trim());
  return answer.toLowerCase() === String(condition.expected || '').trim().toLowerCase();
}

function buildContext(guild, request, type, reason = '') {
  return {
    mention: `<@${request.userId}>`,
    username: request.username || '',
    displayName: request.displayName || request.username || '',
    userId: request.userId || '',
    ticketName: type.name || '',
    ticketId: request.id || '',
    channel: request.reviewChannelId ? `<#${request.reviewChannelId}>` : '',
    server: guild?.name || '',
    avatarUrl: request.avatarUrl || '',
    formAnswers: formatFormAnswers(request.answers),
    reason: reason || '',
  };
}

function replacements(guild, request, type, reason = '') {
  return { '<@mention>': `<@${request.userId}>`, '<username>': request.username || '', '<display_name>': request.displayName || request.username || '', '<user_id>': request.userId || '', '<ticket_name>': type.name || '', '<ticket_id>': request.id || '', '<channel>': request.reviewChannelId ? `<#${request.reviewChannelId}>` : '', '<server>': guild?.name || '', '<avatar_url>': request.avatarUrl || '', '<form-answer>': formatFormAnswers(request.answers), '<reason>': reason || '' };
}
function replaceDeep(value, map) {
  if (typeof value === 'string') { let out = value; for (const [from, to] of Object.entries(map)) out = out.split(from).join(String(to)); return out; }
  if (Array.isArray(value)) return value.map((item) => replaceDeep(item, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDeep(item, map)]));
  return value;
}
async function dmTarget(interaction, member, userId) { return member?.send ? member : interaction.client?.users?.fetch(userId).catch(() => null); }
async function dmText(target, text) {
  if (!target || !String(text || '').trim()) return { ok: false, reason: 'No DM target or message text.' };
  try { await target.send({ content: String(text).slice(0, 2000), allowedMentions: { parse: [] } }); return { ok: true }; }
  catch (error) { return { ok: false, reason: error?.message || 'Discord rejected the DM.' }; }
}
async function dmTemplate(target, guild, request, type, templateId, reason) {
  const template = templateId ? findTemplate(request.guildId, templateId) : null;
  if (!target || !template) return { ok: false, reason: templateId ? 'The selected DM template no longer exists.' : 'No DM template was selected.' };
  try { await target.send(buildMessagePayload(replaceDeep(template, replacements(guild, request, type, reason)))); return { ok: true }; }
  catch (error) { return { ok: false, reason: error?.message || 'Discord rejected the DM template.' }; }
}
function cleanEmojis(value) {
  if (Array.isArray(value)) return value.map(cleanEmojis);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'emoji').map(([key, item]) => [key, cleanEmojis(item)]));
  return value;
}
function invalidEmojiError(error) { return error?.code === 50035 || /Invalid Form Body|emoji/i.test(String(error?.message || '')); }
function expiredInteractionError(error) { return error?.code === 10062 || error?.code === 40060 || /Unknown interaction|already (been )?acknowledged/i.test(String(error?.message || '')); }
async function acknowledgeForWork(interaction) {
  if (interaction.deferred || interaction.replied) return true;
  const defer = typeof interaction.deferUpdate === 'function'
    ? () => interaction.deferUpdate()
    : (typeof interaction.deferReply === 'function' ? () => interaction.deferReply({ flags: EPHEMERAL }) : null);
  if (!defer) return false;
  try { await defer(); return true; }
  catch (error) {
    if (expiredInteractionError(error)) return false;
    throw error;
  }
}
async function editRequestMessage(interaction, payload) {
  if (interaction.message?.edit) return interaction.message.edit(payload);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}
async function updateMessage(interaction, payload) {
  try { await editRequestMessage(interaction, payload); }
  catch (error) {
    if (invalidEmojiError(error)) { await editRequestMessage(interaction, cleanEmojis(payload)); return; }
    if (expiredInteractionError(error) && interaction.message?.edit) {
      try { await interaction.message.edit(payload); }
      catch (editError) {
        if (invalidEmojiError(editError)) { await interaction.message.edit(cleanEmojis(payload)); return; }
        throw editError;
      }
      return;
    }
    throw error;
  }
}
function statusMessage(type, statusLabel, reason, hasWarnings) {
  return { ...type.message, content: `${type.message?.content || ''}\n<separator>\n**Status: ${title(statusLabel)}**${reason ? `\n-# Reason: ${reason}` : ''}${hasWarnings ? '\n-# Some follow-up actions failed; staff received details.' : ''}`.trim() };
}
async function finish(interaction, request, type, control, terminal, reason, state, warnings) {
  request.type = type;
  request.status = terminal || 'processed';
  request.statusLabel = title(control?.name || request.status);
  request.reason = reason;
  request.reviewedBy = interaction.user.id;
  request.reviewedAt = new Date().toISOString();
  state.roleRequests ||= {};
  state.roleRequests[request.id] = request;
  saveState(state);
  await updateMessage(interaction, buildTicketMessagePayload(statusMessage(type, request.statusLabel, reason, warnings.length), buildContext(interaction.guild, request, type, reason), requestComponents(type, request.id, true)));
  if (warnings.length) await interaction.followUp({ content: warnings.join('\n'), flags: EPHEMERAL }).catch(() => null);
  return true;
}
async function execute(action, ctx) {
  if (action.type === 'accept') ctx.terminal = 'accepted';
  if (action.type === 'deny') ctx.terminal = 'denied';
  if (action.type === 'role_add' && ctx.member && action.roleId) {
    const ok = await ctx.member.roles.add(action.roleId, 'Request admin panel role-add action').then(() => true).catch(() => false);
    if (!ok) ctx.warnings.push(`Role add failed for <@${ctx.request.userId}>.`);
  }
  if (action.type === 'blacklist') {
    ctx.state.blacklistedUsersByGuild ||= {};
    const set = new Set(ctx.state.blacklistedUsersByGuild[ctx.request.guildId] || []);
    set.add(ctx.request.userId);
    ctx.state.blacklistedUsersByGuild[ctx.request.guildId] = [...set];
    if (ctx.member && ctx.type.blacklistRoleId) await ctx.member.roles.add(ctx.type.blacklistRoleId, 'Request admin panel blacklist action').catch(() => null);
    ctx.terminal ||= 'blacklisted';
  }
  if (action.type === 'dm_template') {
    const result = action.templateId
      ? await dmTemplate(ctx.target, ctx.guild, ctx.request, ctx.type, action.templateId, ctx.reason)
      : await dmText(ctx.target, replaceDeep(action.text || ctx.control.description || `Your ${ctx.type.name} request was reviewed.`, replacements(ctx.guild, ctx.request, ctx.type, ctx.reason)));
    ctx.dmTried = true;
    if (!result.ok) ctx.warnings.push(`DM failed for <@${ctx.request.userId}>: ${result.reason}`);
  }
}
async function run(interaction, request, type, control, workflow, reason = '') {
  const member = await interaction.guild.members.fetch(request.userId).catch(() => null);
  const ctx = { guild: interaction.guild, member, target: await dmTarget(interaction, member, request.userId), request, type, control, reason, state: loadState(), terminal: '', dmTried: false, warnings: [] };
  if (workflowReady(workflow)) {
    const conditions = new Map((workflow.conditions || []).map((condition) => [condition.id, condition]));
    for (const step of sequence(control, workflow)) {
      const conditionId = stepConditionId(step);
      if (conditionId) {
        const condition = conditions.get(conditionId);
        if (condition && matches(request, type, condition, member)) for (const item of condition.actions || []) await execute(item, ctx);
        continue;
      }
      const typeName = ACTION_MAP[step];
      if (typeName === 'dm_template') await execute({ type: 'dm_template', templateId: workflow.dmTemplateId, text: control.description }, ctx);
      else if (typeName === 'role_add') await execute({ type: 'role_add', roleId: control.moveToTicketTypeId }, ctx);
      else if (typeName) await execute({ type: typeName }, ctx);
    }
    if (!ctx.dmTried && workflow.dmTemplateId && actions(control).includes('dm_template')) await execute({ type: 'dm_template', templateId: workflow.dmTemplateId }, ctx);
  } else {
    for (const action of actions(control)) {
      if (action === 'dm_template') await execute({ type: 'dm_template', text: control.description }, ctx);
      else if (action === 'role_add') await execute({ type: 'role_add', roleId: control.moveToTicketTypeId }, ctx);
      else await execute({ type: action }, ctx);
    }
  }
  return finish(interaction, request, type, control, ctx.terminal, reason, ctx.state, ctx.warnings);
}
async function handleRequestAction(interaction) {
  if (!interaction.guildId) return false;
  let selection = parseSelection(interaction);
  let reason = '';
  if (!selection && interaction.isModalSubmit?.() && interaction.customId?.startsWith('request:reason:')) {
    const [, , requestId, controlId] = interaction.customId.split(':');
    selection = { requestId, controlId };
    reason = interaction.fields.getTextInputValue('reason');
  }
  if (!selection) return false;
  const request = loadState().roleRequests?.[selection.requestId];
  const type = request ? currentType(interaction.guildId, request) : null;
  const control = type?.adminPanel?.controls?.find((item) => item.id === selection.controlId);
  if (!request?.requestKind || !type || !control) return false;
  if (!canUse(interaction, type)) { await interaction.reply({ content: 'You do not have permission to interact with this request.', flags: EPHEMERAL }); return true; }
  if (request.status !== 'pending') { await interaction.reply({ content: 'This request has already been handled.', flags: EPHEMERAL }); return true; }
  const needsReason = !reason && String(control.id).startsWith('reason-') && actions(control).some((action) => ['accept', 'deny', 'blacklist'].includes(action));
  if (needsReason) { await interaction.showModal(reasonModal(request.id, control)); return true; }
  await acknowledgeForWork(interaction);
  return run(interaction, request, type, control, getControlWorkflow(interaction.guildId, type.id, control.id), reason);
}

Module._load = function requestDmRuntimePatch(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestDmRuntimePatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleRequestAction(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestDmRuntimePatched = true;
  return exported;
};

module.exports = { __test: { parseSelection, requestComponents, sequence, title } };
    }],
    ["09-request-form-answer-fix.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const Module = require('module');
const { MessageFlags } = require('discord.js');
const { getGuildConfig, resolveLoggingChannelId } = require('../src/serverConfig');
const { loadState, saveState } = require('../src/ticketSystemStore');
const { buildTicketMessagePayload, formatFormAnswers } = require('../src/ticketConfig');
const requestSelectPatch = require('./05-request-select-panel-fix');

const previousLoad = Module._load;
const EPHEMERAL = MessageFlags.Ephemeral ?? 64;
const CREATE_FORM_PREFIX = 'ticket:create-form:';
const LEGACY_FORM_ID_PREFIX = 'ticket_question_';

function isRequestType(type) {
  return Boolean(type && (String(type.id || '').startsWith('request-') || type.workflow === 'request_role_crew_member_plus'));
}

function configuredType(guildId, id) {
  return (getGuildConfig(guildId)?.tickets?.types || []).find((type) => type.id === id) || null;
}

function getModalComponents(interaction) {
  const raw = interaction?.components ?? interaction?.data?.components ?? [];
  return Array.isArray(raw) ? raw : [];
}

function findSubmittedComponent(interaction, customIds) {
  const ids = new Set((Array.isArray(customIds) ? customIds : [customIds]).filter(Boolean));
  const stack = [...getModalComponents(interaction)];
  while (stack.length) {
    const item = stack.shift();
    if (!item) continue;
    const component = item.component ?? item;
    const customId = component?.custom_id ?? component?.customId;
    if (customId && ids.has(customId)) return component;
    if (Array.isArray(item.components)) stack.push(...item.components);
    if (Array.isArray(component?.components)) stack.push(...component.components);
  }
  return null;
}

function collectionToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return Array.from(value.values());
  return [value];
}

function getCollectionItem(collection, id) {
  if (!collection || !id) return null;
  if (typeof collection.get === 'function') return collection.get(id) ?? null;
  return collection[id] ?? null;
}

function getTextAnswer(interaction, customIds) {
  for (const customId of customIds) {
    try {
      const value = interaction.fields?.getTextInputValue(customId);
      if (value !== undefined && value !== null && value !== '') return String(value);
    } catch {
      // Discord.js throws when a text field is not present for this id.
    }
  }
  const component = findSubmittedComponent(interaction, customIds);
  const value = component?.value;
  return value === undefined || value === null ? '' : String(value);
}

function normalizeAttachment(attachment) {
  if (!attachment) return null;
  const url = attachment.url || attachment.proxyURL || attachment.proxy_url || attachment.attachment || '';
  if (!/^https?:\/\//i.test(url)) return null;
  const clean = String(url).split('?')[0];
  const fallbackName = clean.split('/').pop() || 'uploaded-file';
  return {
    url,
    filename: attachment.name || attachment.filename || fallbackName,
  };
}

function getResolvedAttachment(interaction, id) {
  const resolved = interaction?.data?.resolved?.attachments
    ?? interaction?.resolved?.attachments
    ?? interaction?.fields?.resolved?.attachments
    ?? null;
  return normalizeAttachment(getCollectionItem(resolved, id));
}

function getUploadedFiles(interaction, customIds) {
  for (const customId of customIds) {
    if (typeof interaction?.fields?.getUploadedFiles === 'function') {
      try {
        const fromFields = collectionToArray(interaction.fields.getUploadedFiles(customId))
          .map(normalizeAttachment)
          .filter(Boolean);
        if (fromFields.length) return fromFields;
      } catch {
        // Continue checking alternate custom ids and resolved attachment data.
      }
    }
  }

  const component = findSubmittedComponent(interaction, customIds);
  const fromComponentAttachments = collectionToArray(component?.attachments)
    .map(normalizeAttachment)
    .filter(Boolean);
  if (fromComponentAttachments.length) return fromComponentAttachments;

  const rawValues = component?.values ?? component?.value ?? [];
  const ids = Array.isArray(rawValues) ? rawValues : [rawValues];
  const fromResolved = ids.map((id) => getResolvedAttachment(interaction, id)).filter(Boolean);
  if (fromResolved.length) return fromResolved;

  return collectionToArray(interaction?.attachments).map(normalizeAttachment).filter(Boolean);
}

function getSubmittedValues(interaction, customIds) {
  const component = findSubmittedComponent(interaction, customIds);
  const raw = component?.values ?? component?.value ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.filter((value) => value !== undefined && value !== null && value !== '');
}

function questionCustomIds(question, index) {
  return [
    `${LEGACY_FORM_ID_PREFIX}${index + 1}`,
    question?.id,
  ].filter(Boolean);
}

function optionName(question, value) {
  const byIndex = question.options?.[Number(value)]?.name;
  if (byIndex) return byIndex;
  const byValue = question.options?.find((option) => option.value === value || option.name === value)?.name;
  return byValue || String(value);
}

function requestFormAnswers(interaction, questions) {
  return (Array.isArray(questions) ? questions : [])
    .map((question, index) => {
      const customIds = questionCustomIds(question, index);
      let answer = '';
      let uploadedFiles = [];

      if (question.type === 'text_display') {
        return { order: question.order || index + 1, question: question.question, type: question.type, answer: '' };
      }

      if (question.type === 'text_input') {
        answer = getTextAnswer(interaction, customIds);
      } else if (question.type === 'file_upload') {
        uploadedFiles = getUploadedFiles(interaction, customIds);
        answer = uploadedFiles.map((file) => `[${file.filename}](${file.url})`).join('\n');
      } else if (question.type === 'checkbox') {
        const value = getSubmittedValues(interaction, customIds)[0];
        answer = value === true || value === 'true' || value === 'on' ? 'Yes' : 'No';
      } else {
        const values = getSubmittedValues(interaction, customIds);
        if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) {
          answer = values.map((value) => optionName(question, value)).join(', ');
        } else if (question.type === 'user_select') {
          answer = values.map((value) => `<@${value}>`).join(', ');
        } else if (question.type === 'role_select') {
          answer = values.map((value) => `<@&${value}>`).join(', ');
        } else if (question.type === 'channel_select') {
          answer = values.map((value) => `<#${value}>`).join(', ');
        }
      }

      return {
        order: question.order || index + 1,
        question: question.question,
        type: question.type,
        answer,
        uploadedFiles,
      };
    });
}

function requestContext(interaction, type, requestId, answers) {
  return {
    mention: `<@${interaction.user.id}>`,
    username: interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    userId: interaction.user.id,
    ticketName: type.name,
    ticketId: requestId,
    channel: interaction.channel ? `<#${interaction.channel.id}>` : '',
    server: interaction.guild?.name || '',
    avatarUrl: interaction.user.displayAvatarURL(),
    formAnswers: formatFormAnswers(answers) || '-# No form answers were submitted.',
  };
}

async function submitRequest(interaction, type, answers) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: EPHEMERAL });
  const config = getGuildConfig(interaction.guildId);
  const state = loadState();
  state.roleRequests ||= {};

  if (new Set(state.blacklistedUsersByGuild?.[interaction.guildId] || []).has(interaction.user.id)) {
    await interaction.editReply({ content: 'You are not allowed to create this request.' });
    return true;
  }

  const reviewChannelId = type.transcriptChannelId || resolveLoggingChannelId(config, 'requests', 'role_review', config.channels?.roleRequestReview);
  const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!reviewChannel?.isTextBased()) {
    await interaction.editReply({ content: 'The request review channel is unavailable. Ask an administrator to configure it.' });
    return true;
  }

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const request = {
    requestKind: 'configurable',
    id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    username: interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL(),
    type,
    answers,
    status: 'pending',
    statusLabel: 'Pending',
    reviewChannelId,
    createdAt: new Date().toISOString(),
  };

  const requestComponents = requestSelectPatch.__test?.requestComponents?.(type, id) || [];
  const message = await reviewChannel.send(buildTicketMessagePayload(type.message, requestContext(interaction, type, id, answers), requestComponents));
  request.reviewMessageId = message.id;
  state.roleRequests[id] = request;
  saveState(state);
  await interaction.editReply({ content: `Your ${type.name} request has been submitted.` });
  return true;
}

async function handleRequestCreateForm(interaction) {
  if (!interaction?.guildId || !interaction?.isModalSubmit?.()) return false;
  if (!interaction.customId?.startsWith(CREATE_FORM_PREFIX)) return false;
  const type = configuredType(interaction.guildId, interaction.customId.slice(CREATE_FORM_PREFIX.length));
  if (!isRequestType(type)) return false;
  const questions = type.forms?.enabled ? type.forms.create || [] : [];
  if (!questions.length) return false;
  return submitRequest(interaction, type, requestFormAnswers(interaction, questions));
}

Module._load = function requestFormAnswerPatch(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestFormAnswerPatched) return exported;
  const nativeHandle = exported.handleInteraction?.bind(exported);
  if (!nativeHandle) return exported;
  exported.handleInteraction = async (interaction, client) => {
    if (await handleRequestCreateForm(interaction)) return true;
    return nativeHandle(interaction, client);
  };
  exported.__requestFormAnswerPatched = true;
  return exported;
};

module.exports = { __test: { requestFormAnswers, optionName } };
    }],
  ];
  for (const [name, factory] of fixes) {
    const filename = require('path').join(__dirname, '..', 'commands', name);
    const fixModule = new ConsolidatedFixModule(filename, module);
    fixModule.filename = filename;
    fixModule.paths = ConsolidatedFixModule._nodeModulePaths(require('path').dirname(filename));
    require.cache[filename] = fixModule;
    factory.call(fixModule.exports, fixModule, fixModule.exports, fixModule.require.bind(fixModule), filename, require('path').dirname(filename));
    fixModule.loaded = true;
  }
  ConsolidatedFixModule._load(__filename, module.parent, false);
})();
