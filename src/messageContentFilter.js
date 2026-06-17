'use strict';

function stripNoise(content) {
  return String(content || '').trim();
}

function hasTextPayload(message) {
  if (!message?.guild || message.author?.bot) return false;
  return stripNoise(message.content).length > 0; // ADDED: text-only guard.
}

function shouldIgnoreTextlessMessage(message) {
  if (!message?.guild || message.author?.bot) return true;
  return !hasTextPayload(message); // ADDED: central message filter.
}

module.exports = { hasTextPayload, shouldIgnoreTextlessMessage, stripNoise };
