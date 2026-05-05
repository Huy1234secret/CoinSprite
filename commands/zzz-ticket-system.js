const fs = require('fs');
const path = require('path');
const {
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const original = require('./ticket-system');
const { loadState, saveState } = require('../src/ticketSystemStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const STAFF_ROLE_ID = '1494993523064443065';
const TRANSCRIPT_CHANNEL_ID = '1495788766600757418';

const CUSTOM_IDS = {
  ticketActionSelectPrefix: 'ticket:actions:',
  giveawayCloseEvidenceModalPrefix: 'ticket:giveaway-close-evidence:',
  giveawayCloseEvidenceUpload: 'giveaway_close_claim_evidence_upload',
};

function canUseStaffActions(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.has(STAFF_ROLE_ID);
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

function isGiveawayTicket(channel, ticketRecord) {
  return /giveaway/i.test(String(ticketRecord?.ticketType || '')) || /giveaway/i.test(String(channel?.name || ''));
}

function sanitizeAttachmentName(filename, fallbackIndex = 0) {
  const base = String(filename || `upload-${fallbackIndex + 1}`).trim();
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return safe || `upload-${fallbackIndex + 1}`;
}

function getFilenameFromUrl(url) {
  if (!url) return 'file.unknown';
  const clean = String(url).split('?')[0];
  const name = clean.split('/').pop();
  return name || 'file.unknown';
}

function normalizeUploadedAttachment(attachment) {
  if (!attachment) return null;
  return {
    id: attachment.id,
    url: attachment.url,
    contentType: attachment.contentType || attachment.content_type || '',
    filename: attachment.name || attachment.filename || getFilenameFromUrl(attachment.url),
  };
}

function getModalComponents(interaction) {
  const rawComponents = interaction.components ?? interaction?.data?.components ?? [];
  return Array.isArray(rawComponents) ? rawComponents : [];
}

function findSubmittedComponent(interaction, customId) {
  for (const wrapper of getModalComponents(interaction)) {
    const component = wrapper?.component ?? wrapper?.components?.[0] ?? null;
    if (component?.custom_id === customId || component?.customId === customId) return component;
  }
  return null;
}

function getUploadedAttachmentDetails(interaction, customId) {
  const fromFieldAccessor = typeof interaction?.fields?.getUploadedFiles === 'function'
    ? interaction.fields.getUploadedFiles(customId).map(normalizeUploadedAttachment).filter(Boolean)
    : [];
  if (fromFieldAccessor.length > 0) return fromFieldAccessor;

  const fileUploadComponent = findSubmittedComponent(interaction, customId);
  const attachmentIds = fileUploadComponent?.values ?? [];
  const resolvedAttachments = interaction?.data?.resolved?.attachments ?? interaction?.resolved?.attachments ?? {};
  const fromResolved = attachmentIds.map((id) => normalizeUploadedAttachment(resolvedAttachments[id])).filter(Boolean);
  if (fromResolved.length > 0) return fromResolved;

  return Array.from(interaction?.attachments?.values?.() ?? []).map(normalizeUploadedAttachment).filter(Boolean);
}

function getUploadedMediaGallery(uploadedEvidence) {
  const items = uploadedEvidence.slice(0, 10).map((item, index) => ({
    media: { url: item.url },
    description: sanitizeAttachmentName(item.filename, index),
  }));
  return items.length ? { type: 12, items } : null;
}

function getEvidenceLinks(uploadedEvidence) {
  return uploadedEvidence
    .slice(0, 10)
    .map((item, index) => `- [${sanitizeAttachmentName(item.filename, index)}](${item.url})`)
    .join('\n');
}

async function showGiveawayCloseEvidenceModal(interaction) {
  await interaction.showModal({
    custom_id: `${CUSTOM_IDS.giveawayCloseEvidenceModalPrefix}${interaction.channelId}:${interaction.message.id}`,
    title: 'Close Giveaway Ticket',
    components: [
      {
        type: 18,
        label: 'Provide evidence of all WINNERS claimed their prize',
        component: {
          type: 19,
          custom_id: CUSTOM_IDS.giveawayCloseEvidenceUpload,
          required: true,
          min_values: 1,
          max_values: 10,
        },
      },
    ],
  });
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

function getAttachmentTranscriptValue(attachment) {
  if (!attachment?.url) return '';
  const contentType = String(attachment.contentType || '').toLowerCase();
  const fileName = String(attachment.name || attachment.filename || '').toLowerCase();
  if (contentType.includes('gif') || fileName.endsWith('.gif')) return `GIF: ${attachment.url}`;
  if (contentType.startsWith('image/')) return `Image attachment: ${attachment.url}`;
  if (contentType.startsWith('video/')) return `Video attachment: ${attachment.url}`;
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
    const attachments = [...message.attachments.values()].map((attachment) => getAttachmentTranscriptValue(attachment)).filter(Boolean).join(' ');
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
    'Close Action: close',
  ];
  fs.writeFileSync(filePath, `${headerLines.join('\n')}\n\n${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

async function closeGiveawayTicketWithEvidence(interaction, channelId, actionMessageId) {
  const state = loadState();
  const ticketRecord = state.tickets[channelId];
  const channel = interaction.channel ?? await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!ticketRecord || !channel?.isTextBased()) {
    await interaction.reply({ content: 'This ticket record is missing.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!canUseStaffActions(interaction.member)) {
    await interaction.reply({ content: 'Only staff can close tickets.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const uploadedEvidence = getUploadedAttachmentDetails(interaction, CUSTOM_IDS.giveawayCloseEvidenceUpload);
  if (uploadedEvidence.length === 0) {
    await interaction.reply({ content: 'Please upload evidence before closing this giveaway ticket.', flags: EPHEMERAL_FLAG });
    return true;
  }

  await interaction.reply({ content: 'Closing ticket...', flags: EPHEMERAL_FLAG });
  const ticketOwner = await interaction.guild.members.fetch(ticketRecord.userId).catch(() => null);
  if (ticketOwner) await channel.permissionOverwrites.edit(ticketOwner.id, { SendMessages: false }).catch(() => null);

  ticketRecord.closed = true;
  ticketRecord.giveawayCloseEvidence = uploadedEvidence;
  state.tickets[channelId] = ticketRecord;
  saveState(state);

  await channel.send(container(0xfff200, 'Transcript saving!...'));
  const transcriptPath = await saveTranscript(channel, {
    ticketRecord,
    closedBy: interaction.user.id,
  });

  const transcriptChannel = await interaction.guild.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (transcriptChannel?.isTextBased()) {
    const mediaGallery = getUploadedMediaGallery(uploadedEvidence);
    await transcriptChannel.send({
      flags: COMPONENTS_V2_FLAG,
      files: [transcriptPath],
      components: [
        {
          type: 17,
          accent_color: 0xffffff,
          components: [
            { type: 10, content: `## Transcript for #${channel.name} (${channel.id})\n### Winner claim evidence links\n${getEvidenceLinks(uploadedEvidence)}` },
            ...(mediaGallery ? [{ type: 14, divider: true, spacing: 1 }, mediaGallery] : []),
          ],
        },
      ],
    }).catch(() => null);
  }

  await channel.send(container(0x00ff00, 'Transcript saved!'));
  await channel.send(container(0xff0000, 'Deleting ticket...'));

  const originalMessage = actionMessageId ? await channel.messages.fetch(actionMessageId).catch(() => null) : null;
  if (originalMessage) {
    await originalMessage.edit({ components: [getTicketActionRow(channelId, true)] }).catch(() => null);
  }

  setTimeout(() => {
    channel.delete('Ticket closed').catch(() => null);
  }, 3000);

  return true;
}

module.exports = {
  ...original,
  async handleInteraction(interaction, client) {
    if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith(CUSTOM_IDS.ticketActionSelectPrefix)) {
      const state = loadState();
      const ticketRecord = state.tickets[interaction.channelId];
      const action = interaction.values?.[0];
      if (action === 'close_ticket' && ticketRecord && isGiveawayTicket(interaction.channel, ticketRecord)) {
        if (!canUseStaffActions(interaction.member)) {
          await interaction.reply({ content: 'Only staff can use ticket actions.', flags: EPHEMERAL_FLAG });
          return true;
        }
        await showGiveawayCloseEvidenceModal(interaction);
        return true;
      }
    }

    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith(CUSTOM_IDS.giveawayCloseEvidenceModalPrefix)) {
      const [, channelId, actionMessageId] = interaction.customId.match(/^ticket:giveaway-close-evidence:([^:]+):([^:]+)$/) || [];
      if (!channelId) {
        await interaction.reply({ content: 'Could not identify this giveaway ticket.', flags: EPHEMERAL_FLAG });
        return true;
      }
      return closeGiveawayTicketWithEvidence(interaction, channelId, actionMessageId);
    }

    if (typeof original.handleInteraction === 'function') {
      return original.handleInteraction(interaction, client);
    }
    return false;
  },
};
