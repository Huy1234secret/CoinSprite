'use strict';

function isLinkToken(value) {
  const text = String(value || '').trim().toLowerCase();
  return text.includes('://') || text.startsWith('www.'); // ADDED: link-only messages do not count as text.
}

function isWrappedToken(value) {
  const text = String(value || '').trim();
  return text.startsWith('<') && text.endsWith('>'); // ADDED: mentions and custom emoji are ignored as standalone tokens.
}

function isSymbolOnly(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !/[A-Za-z0-9]/.test(text); // ADDED: emoji/symbol-only tokens are ignored.
}

function stripNoise(content) {
  return String(content || '').split(/\s+/).filter((token) => token && !isLinkToken(token) && !isWrappedToken(token) && !isSymbolOnly(token)).join(' ').trim();
}

function hasTextPayload(message) {
  if (!message?.guild || message.author?.bot) return false;
  return stripNoise(message.content).length > 0; // ADDED: only count messages that contain real text after emoji/link cleanup.
}

function shouldIgnoreTextlessMessage(message) {
  if (!message?.guild || message.author?.bot) return true;
  return !hasTextPayload(message); // ADDED: shared guard for XP, moderation, stats, and invite message hooks.
}

module.exports = {
  hasTextPayload,
  shouldIgnoreTextlessMessage,
  stripNoise,
};
