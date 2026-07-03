'use strict';

const MAX_DELETE_AMOUNT = 100;
const MAX_SCAN_PAGES = 10;
const PAGE_SIZE = 100;

function normalizeDeleteAmount(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(MAX_DELETE_AMOUNT, parsed));
}

function collectionValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  return Object.values(value);
}

function messageTimestamp(message) {
  return Number(message?.createdTimestamp)
    || Number(message?.createdAt?.getTime?.())
    || 0;
}

async function findRecentUserMessages(triggerMessage, rawAmount) {
  const amount = normalizeDeleteAmount(rawAmount);
  const authorId = String(triggerMessage?.author?.id || '');
  if (!authorId) return [];

  const found = new Map();
  if (triggerMessage?.id) found.set(triggerMessage.id, triggerMessage);
  if (found.size >= amount) return [...found.values()];

  const manager = triggerMessage?.channel?.messages;
  if (typeof manager?.fetch !== 'function') return [...found.values()];

  let before = '';
  for (let page = 0; page < MAX_SCAN_PAGES && found.size < amount; page += 1) {
    const options = { limit: PAGE_SIZE };
    if (before) options.before = before;
    const batch = await manager.fetch(options).catch(() => null);
    const messages = collectionValues(batch).sort((left, right) => messageTimestamp(right) - messageTimestamp(left));
    if (!messages.length) break;

    for (const message of messages) {
      if (String(message?.author?.id || '') !== authorId || !message?.id) continue;
      found.set(message.id, message);
      if (found.size >= amount) break;
    }

    const oldest = messages[messages.length - 1];
    const nextBefore = String(oldest?.id || '');
    if (!nextBefore || nextBefore === before || messages.length < PAGE_SIZE) break;
    before = nextBefore;
  }

  return [...found.values()]
    .sort((left, right) => messageTimestamp(right) - messageTimestamp(left))
    .slice(0, amount);
}

async function deleteRecentUserMessages(triggerMessage, rawAmount) {
  const amount = normalizeDeleteAmount(rawAmount);
  const messages = await findRecentUserMessages(triggerMessage, amount);
  let deleted = 0;

  for (const message of messages) {
    if (!message || message.deleted || message.deletable === false || typeof message.delete !== 'function') continue;
    const success = await message.delete().then(() => true).catch(() => false);
    if (success) deleted += 1;
  }

  return { requested: amount, found: messages.length, deleted };
}

module.exports = {
  MAX_DELETE_AMOUNT,
  MAX_SCAN_PAGES,
  deleteRecentUserMessages,
  findRecentUserMessages,
  normalizeDeleteAmount,
};
