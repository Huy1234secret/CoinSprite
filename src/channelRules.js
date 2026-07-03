'use strict';

const fs = require('fs');
const path = require('path');

const CONTEXT_TYPES = Object.freeze([
  'text',
  'link',
  'image',
  'video',
  'audio',
  'voice_message',
  'file',
  'sticker',
  'embed',
  'poll',
]);

const ACTION_TYPES = new Set(['delete', 'report', 'mute', 'kick', 'ban', 'send_message']);
const CONTEXT_SET = new Set(CONTEXT_TYPES);
const LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const ID_PATTERN = /^\d{16,20}$/;
const DEFAULT_REASON = 'This message used content that is not permitted in this channel.';

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function cleanId(value) {
  const text = String(value || '').trim();
  return ID_PATTERN.test(text) ? text : '';
}

function cleanReason(value) {
  return String(value || DEFAULT_REASON).trim().slice(0, 1000) || DEFAULT_REASON;
}

function cleanRuleId(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return text.slice(0, 40) || ('channel-rule-' + Date.now().toString(36));
}

function cleanTime(value, fallback) {
  const text = String(value || fallback).trim().toLowerCase();
  return /^(?:\d+\s*[mhdw]|permanent|perm|never)$/.test(text) ? text : fallback;
}

function cleanMuteTime(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || ['permanent', 'perm', 'never'].includes(text)) return '';
  const match = text.match(/^(\d+)\s*([mhdw])$/);
  if (!match) return '10m';
  const units = { m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const durationMs = Number(match[1]) * units[match[2]];
  return durationMs > 28 * 86400000 ? '' : text;
}

function normalizeAction(value = {}) {
  const type = String(typeof value === 'string' ? value : value.type || '').trim().toLowerCase();
  if (!ACTION_TYPES.has(type)) return null;
  const action = { type };

  if (type === 'delete') action.reason = cleanReason(value.reason);
  if (type === 'report') {
    action.reason = cleanReason(value.reason);
    action.reportChannelId = cleanId(value.reportChannelId || value.channelId);
  }
  if (type === 'mute') {
    action.reason = cleanReason(value.reason);
    action.time = cleanMuteTime(value.time);
  }
  if (type === 'kick') action.reason = cleanReason(value.reason);
  if (type === 'ban') {
    action.reason = cleanReason(value.reason);
    action.time = cleanTime(value.time, 'permanent');
  }
  if (type === 'send_message') {
    action.templateId = String(value.templateId || '').trim().slice(0, 40);
    action.ephemeral = Boolean(value.ephemeral);
  }
  return action;
}

function normalizeRule(value = {}, index = 0) {
  return {
    id: cleanRuleId(value.id || ('channel-rule-' + (index + 1))),
    name: String(value.name || ('Channel rule ' + (index + 1))).trim().slice(0, 80) || ('Channel rule ' + (index + 1)),
    enabled: value.enabled !== false,
    channelIds: uniqueStrings(value.channelIds).map(cleanId).filter(Boolean),
    mode: value.mode === 'not_allowed' ? 'not_allowed' : 'allowed',
    contexts: uniqueStrings(value.contexts).filter((item) => CONTEXT_SET.has(item)),
    actions: (Array.isArray(value.actions) ? value.actions : []).map(normalizeAction).filter(Boolean).slice(0, 10),
  };
}

function normalizeRules(value) {
  const source = Array.isArray(value) ? value : value?.rules;
  const ids = new Set();
  return (Array.isArray(source) ? source : []).slice(0, 100).map(normalizeRule).map((rule) => {
    let id = rule.id;
    let suffix = 2;
    while (ids.has(id)) id = (rule.id.slice(0, 36) + '-' + suffix++).slice(0, 40);
    ids.add(id);
    return { ...rule, id };
  });
}

function attachmentKind(attachment) {
  const contentType = String(attachment?.contentType || attachment?.content_type || '').toLowerCase();
  const name = String(attachment?.name || attachment?.filename || '').toLowerCase();
  if (contentType.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif)$/i.test(name)) return 'image';
  if (contentType.startsWith('video/') || /\.(?:mp4|mov|webm|mkv)$/i.test(name)) return 'video';
  if (contentType.startsWith('audio/') || /\.(?:mp3|wav|ogg|m4a|flac)$/i.test(name)) return 'audio';
  return 'file';
}

function collectionValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  return Object.values(value);
}

function classifyMessage(message) {
  const types = new Set();
  const content = String(message?.content || '').trim();
  const links = content.match(LINK_PATTERN) || [];
  if (links.length) types.add('link');
  if (content.replace(LINK_PATTERN, '').trim()) types.add('text');

  const voiceMessage = Boolean(message?.flags?.has?.(8192) || (Number(message?.flags?.bitfield) & 8192));
  if (voiceMessage) types.add('voice_message');
  for (const attachment of collectionValues(message?.attachments)) {
    const kind = attachmentKind(attachment);
    if (voiceMessage && kind === 'audio') continue;
    types.add(kind);
  }
  if (collectionValues(message?.stickers).length) types.add('sticker');
  if (collectionValues(message?.embeds).length) types.add('embed');
  if (message?.poll) types.add('poll');
  if (!types.size) types.add('file');
  return [...types];
}

function ruleMatchesChannel(rule, message) {
  const ids = new Set(rule.channelIds || []);
  return ids.has(String(message?.channelId || '')) || ids.has(String(message?.channel?.parentId || ''));
}

function isRuleViolation(rule, messageTypes) {
  const selected = new Set(rule.contexts || []);
  const observed = Array.isArray(messageTypes) ? messageTypes : [];
  if (rule.mode === 'not_allowed') return observed.some((type) => selected.has(type));
  return observed.some((type) => !selected.has(type));
}

function storePath() {
  return process.env.CHANNEL_RULES_STORE_PATH || path.join(__dirname, '..', 'data', 'channel-rules.json');
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { guilds: {} };
  } catch {
    return { guilds: {} };
  }
}

function saveStore(value) {
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, target);
}

function getGuildRules(guildId) {
  return normalizeRules(loadStore().guilds?.[String(guildId)] || []);
}

function saveGuildRules(guildId, rules) {
  const store = loadStore();
  store.guilds ||= {};
  const normalized = normalizeRules(rules);
  store.guilds[String(guildId)] = normalized;
  saveStore(store);
  return normalized;
}

module.exports = {
  CONTEXT_TYPES,
  DEFAULT_REASON,
  classifyMessage,
  getGuildRules,
  isRuleViolation,
  normalizeAction,
  normalizeRule,
  normalizeRules,
  ruleMatchesChannel,
  saveGuildRules,
};
