'use strict';

const MAX_EVIDENCE_ATTACHMENTS = 10;

function collectionValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  return Object.values(value);
}

function safeFilename(value, index) {
  const cleaned = String(value || 'evidence.bin')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 160) || 'evidence.bin';
  return String(index + 1).padStart(2, '0') + '-' + cleaned;
}

function mediaKind(attachment) {
  const contentType = String(attachment?.contentType || attachment?.content_type || '').toLowerCase();
  const name = String(attachment?.name || attachment?.filename || '').toLowerCase();
  if (contentType.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif)$/i.test(name)) return 'image';
  if (contentType.startsWith('video/') || /\.(?:mp4|mov|webm|mkv)$/i.test(name)) return 'video';
  return '';
}

function messageUrl(message) {
  return message?.url || (
    message?.guildId && message?.channelId && message?.id
      ? 'https://discord.com/channels/' + message.guildId + '/' + message.channelId + '/' + message.id
      : ''
  );
}

function evidenceAttachments(message) {
  return collectionValues(message?.attachments).slice(0, MAX_EVIDENCE_ATTACHMENTS).map((attachment, index) => ({
    originalName: String(attachment?.name || attachment?.filename || ('evidence-' + (index + 1))),
    copiedName: safeFilename(attachment?.name || attachment?.filename, index),
    contentType: String(attachment?.contentType || attachment?.content_type || ''),
    size: Math.max(0, Number(attachment?.size) || 0),
    url: String(attachment?.url || attachment?.attachment || ''),
    kind: mediaKind(attachment),
  })).filter((attachment) => attachment.url);
}

function resolvedAttachmentUrl(attachment, options = {}) {
  const urls = options.attachmentUrls;
  return String(urls?.get?.(attachment.copiedName) || urls?.[attachment.copiedName] || attachment.url || '');
}

function attachmentLink(attachment, options = {}) {
  const label = attachment.originalName.replace(/[\\[\]\\]/g, (character) => '\\' + character);
  let url = resolvedAttachmentUrl(attachment, options);
  try { url = encodeURI(url); } catch {}
  return '[' + label + '](' + url + ')';
}

function buildReportEvidenceText(message, options = {}) {
  const attachments = evidenceAttachments(message);
  const lines = [
    messageUrl(message) || 'Message link unavailable',
    '',
    '**Message content**',
    String(message?.content || '') || '[No text content]',
  ];
  if (attachments.length) {
    lines.push('', '**Attachments**');
    for (const attachment of attachments) {
      lines.push('- ' + attachmentLink(attachment, options));
    }
  }
  return lines.join('\n');
}

function findContainer(payload) {
  return collectionValues(payload?.components).find((component) => Number(component?.type) === 17) || null;
}

function addReportAttachments(payload, message, options = {}) {
  const attachments = evidenceAttachments(message);
  const container = findContainer(payload);
  if (!attachments.length || !container || !Array.isArray(container.components)) return payload;

  const copyAttachments = options.copyAttachments !== false;
  const media = attachments.filter((attachment) => attachment.kind);
  if (media.length && options.includeGallery !== false) {
    container.components.push({
      type: 12,
      items: media.map((attachment) => ({
        media: { url: resolvedAttachmentUrl(attachment, options) },
        description: attachment.originalName.slice(0, 1024),
      })),
    });
  }

  if (copyAttachments) {
    const files = attachments.map((attachment) => ({
      attachment: attachment.url,
      name: attachment.copiedName,
    }));
    payload.files = [...(Array.isArray(payload.files) ? payload.files : []), ...files];
    for (const attachment of attachments.filter((item) => !item.kind)) {
      container.components.push({ type: 13, file: { url: 'attachment://' + attachment.copiedName } });
    }
  }

  return payload;
}

function uploadedAttachmentUrls(message) {
  return new Map(collectionValues(message?.attachments)
    .filter((attachment) => attachment?.name && attachment?.url)
    .map((attachment) => [String(attachment.name), String(attachment.url)]));
}

module.exports = {
  MAX_EVIDENCE_ATTACHMENTS,
  addReportAttachments,
  attachmentLink,
  buildReportEvidenceText,
  evidenceAttachments,
  mediaKind,
  messageUrl,
  resolvedAttachmentUrl,
  safeFilename,
  uploadedAttachmentUrls,
};
