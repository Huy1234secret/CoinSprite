'use strict';

const SINGLE_MENTION = /^<(?:@!?|@&|#)\d{16,20}>$/;
const CUSTOM_EMOJI = /<a?:[a-z0-9_]{2,32}:\d{16,20}>/gi;
const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)$/i;

function collectionValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  return Object.values(value);
}

function isLinkOnly(value) {
  const text = String(value || '').trim();
  const unwrapped = text.startsWith('<') && text.endsWith('>') ? text.slice(1, -1) : text;
  return /^(?:https?:\/\/|www\.)\S+$/i.test(unwrapped);
}

function isEmojiOnly(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const withoutCustomEmoji = text.replace(CUSTOM_EMOJI, '');
  return withoutCustomEmoji.replace(/[\p{Emoji}\uFE0F\u200D\u20E3\s]/gu, '') === '';
}

function isImageAttachment(attachment) {
  const contentType = String(attachment?.contentType || attachment?.content_type || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  const pathname = String(attachment?.name || attachment?.url || '').split(/[?#]/, 1)[0];
  return IMAGE_EXTENSION.test(pathname);
}

function moderationIgnoreReason(message, moderationText = message?.content) {
  const text = String(moderationText || '').trim();
  if (SINGLE_MENTION.test(text)) return 'single-mention';
  if (isLinkOnly(text)) return 'link-only';
  if (isEmojiOnly(text)) return 'emoji-only';
  if (text) return '';

  const attachments = collectionValues(message?.attachments);
  if (attachments.length && attachments.every(isImageAttachment)) return 'image-only';
  if (!attachments.length && collectionValues(message?.stickers).length) return 'emoji-only';
  return '';
}

module.exports = { isEmojiOnly, isImageAttachment, isLinkOnly, moderationIgnoreReason };
