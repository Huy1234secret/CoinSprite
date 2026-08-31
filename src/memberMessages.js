const {
  MessageFlags,
  MessageType,
  PermissionFlagsBits,
} = require('discord.js');
const { logCommandSystem } = require('./commandLogger');
const { getGuildConfig } = require('./serverConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const BOOST_DEDUPE_WINDOW_MS = 30_000;
const BOOST_SYSTEM_MESSAGE_TYPES = new Set([
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
  MessageType.UserPremiumGuildSubscription,
  MessageType.UserPremiumGuildSubscriptionTier1,
  MessageType.UserPremiumGuildSubscriptionTier2,
  MessageType.UserPremiumGuildSubscriptionTier3,
].filter(Number.isInteger));
const recentBoostAnnouncements = new Map();

function interpolateTemplate(template, values = {}) {
  return String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (token, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : token
  ));
}

function safeMediaUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function avatarUrl(user) {
  try {
    return String(user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '');
  } catch {
    return '';
  }
}

function serverIconUrl(guild) {
  try {
    return String(guild?.iconURL?.({ extension: 'png', size: 256 }) || '');
  } catch {
    return '';
  }
}

function discordTimestamp(value, fallback = 'Not available') {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? `<t:${Math.floor(milliseconds / 1000)}:F>`
    : fallback;
}

function humanDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
  if (seconds < 60) return 'less than a minute';
  const units = [
    ['year', 365 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
  ];
  for (const [name, size] of units) {
    const count = Math.floor(seconds / size);
    if (count > 0) return `${count} ${name}${count === 1 ? '' : 's'}`;
  }
  return 'less than a minute';
}

function boostLevel(guild) {
  const numeric = Number(guild?.premiumTier);
  if (Number.isFinite(numeric)) return String(Math.max(0, Math.min(3, Math.floor(numeric))));
  const match = String(guild?.premiumTier || '').match(/(\d)/);
  return match ? match[1] : '0';
}

function memberMessageValues(type, member, options = {}) {
  const nowMs = Number(options.nowMs) || Date.now();
  const guild = member?.guild || options.guild || {};
  const user = member?.user || options.user || {};
  const userId = String(user.id || member?.id || options.userId || '');
  const joinedAt = Number(member?.joinedTimestamp);
  const createdAt = Number(user.createdTimestamp);
  const premiumSince = Number(member?.premiumSinceTimestamp ?? member?.premiumSince?.getTime?.());
  const channelId = String(options.channelId || '');
  const values = {
    user: userId ? `<@${userId}>` : '@member',
    username: String(user.username || 'Member'),
    display_name: String(member?.displayName || user.globalName || user.username || 'Member'),
    user_id: userId || 'Unknown',
    user_avatar: avatarUrl(user),
    server: String(guild.name || 'Server'),
    server_icon: serverIconUrl(guild),
    member_count: String(Math.max(0, Number(guild.memberCount) || 0)),
    channel: channelId ? `<#${channelId}>` : '#channel',
    timestamp: discordTimestamp(nowMs),
  };
  if (type === 'join') {
    values.joined_at = discordTimestamp(joinedAt || nowMs);
    values.account_created = discordTimestamp(createdAt);
    values.account_age = createdAt > 0 ? humanDuration(nowMs - createdAt) : 'Not available';
  } else if (type === 'leave') {
    values.joined_at = discordTimestamp(joinedAt);
    values.time_in_server = joinedAt > 0 ? humanDuration(nowMs - joinedAt) : 'Not available';
  } else if (type === 'boost') {
    values.boost_count = String(Math.max(0, Number(guild.premiumSubscriptionCount) || 0));
    values.boost_level = boostLevel(guild);
    values.boost_since = discordTimestamp(premiumSince || nowMs);
  }
  return values;
}

function accentColorValue(value) {
  const hex = String(value || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : 0x57f287;
}

function resolvedLayout(layout = {}, values = {}) {
  const resolve = (url) => safeMediaUrl(interpolateTemplate(url, values));
  return {
    ...layout,
    thumbnailUrl: resolve(layout.thumbnailUrl),
    galleryUrls: [...new Set((layout.galleryUrls || []).map(resolve).filter(Boolean))].slice(0, 10),
  };
}

function messageContentComponents(content, layout = {}, label = 'Member message') {
  const rawParts = String(content || '').split(/\{separator\}/gi);
  const parts = rawParts.length > 5
    ? [...rawParts.slice(0, 4), rawParts.slice(4).join('\n')]
    : rawParts;
  const thumbnailUrl = layout.thumbnailEnabled ? safeMediaUrl(layout.thumbnailUrl) : '';
  const components = [];
  let thumbnailPlaced = false;

  for (let index = 0; index < parts.length; index += 1) {
    const text = parts[index].trim();
    if (index > 0 && components.length && components.at(-1)?.type !== 14) {
      components.push({ type: 14, divider: true, spacing: 1 });
    }
    if (!text) continue;
    if (thumbnailUrl && !thumbnailPlaced) {
      components.push({
        type: 9,
        components: [{ type: 10, content: text }],
        accessory: { type: 11, media: { url: thumbnailUrl }, description: `${label} thumbnail` },
      });
      thumbnailPlaced = true;
    } else components.push({ type: 10, content: text });
  }
  if (!components.length) components.push({ type: 10, content: '-# Member update' });

  const galleryUrls = [...new Set((layout.galleryUrls || []).map(safeMediaUrl).filter(Boolean))].slice(0, 10);
  if (galleryUrls.length) {
    components.push({
      type: 12,
      items: galleryUrls.map((url) => ({ media: { url }, description: `${label} image` })),
    });
  }
  return components;
}

function memberMessagePayload(type, member, eventConfig, options = {}) {
  const values = memberMessageValues(type, member, {
    ...options,
    channelId: options.channelId || eventConfig?.channelId,
  });
  const layout = resolvedLayout(eventConfig?.layout, values);
  const content = interpolateTemplate(eventConfig?.template, values).slice(0, 4000);
  const inner = messageContentComponents(content, layout, `${type} message`);
  const userId = String(member?.user?.id || member?.id || '');
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [], users: /^\d{16,20}$/.test(userId) ? [userId] : [], roles: [] },
    components: layout.container === false ? inner : [{
      type: 17,
      accent_color: accentColorValue(layout.accentColor),
      components: inner,
    }],
  };
}

async function resolveDeliveryChannel(guild, channelId) {
  if (!guild || !/^\d{16,20}$/.test(String(channelId || ''))) return null;
  return guild.channels?.cache?.get?.(channelId)
    || await guild.channels?.fetch?.(channelId).catch(() => null)
    || null;
}

async function deliveryPermissions(channel, guild, needsEmbedLinks) {
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return { ok: false, missing: ['message-capable channel'] };
  const botMember = guild?.members?.me || await guild?.members?.fetchMe?.().catch(() => null);
  let permissions = null;
  try { permissions = channel.permissionsFor?.(botMember); } catch {}
  const required = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['SendMessages', PermissionFlagsBits.SendMessages],
  ];
  if (channel.isThread?.()) required.push(['SendMessagesInThreads', PermissionFlagsBits.SendMessagesInThreads]);
  if (needsEmbedLinks) required.push(['EmbedLinks', PermissionFlagsBits.EmbedLinks]);
  const missing = required.filter(([, flag]) => !permissions?.has?.(flag)).map(([name]) => name);
  return { ok: missing.length === 0, missing };
}

async function sendMemberMessage(type, member, options = {}) {
  const guild = member?.guild || options.guild;
  const guildId = String(guild?.id || '');
  const getConfig = options.getConfig || getGuildConfig;
  const log = options.log || logCommandSystem;
  const config = options.config || getConfig(guildId)?.memberMessages;
  if (!config?.enabled) return { sent: false, reason: 'global-disabled' };
  const eventConfig = config[type];
  if (!eventConfig?.enabled) return { sent: false, reason: 'event-disabled' };
  const channel = await resolveDeliveryChannel(guild, eventConfig.channelId);
  if (!channel) {
    log(`Welcome Messages: ${type} delivery skipped in guild ${guildId || 'unknown'} because channel ${eventConfig.channelId || 'not configured'} is unavailable.`);
    return { sent: false, reason: 'missing-channel' };
  }
  const values = memberMessageValues(type, member, { channelId: channel.id, nowMs: options.nowMs });
  const layout = resolvedLayout(eventConfig.layout, values);
  const needsEmbedLinks = Boolean((layout.thumbnailEnabled && layout.thumbnailUrl) || layout.galleryUrls.length);
  const permissions = await deliveryPermissions(channel, guild, needsEmbedLinks);
  if (!permissions.ok) {
    log(`Welcome Messages: ${type} delivery skipped in guild ${guildId} because CoinSprite lacks ${permissions.missing.join(', ')} in channel ${channel.id}.`);
    return { sent: false, reason: 'insufficient-permissions', missing: permissions.missing };
  }
  const payload = memberMessagePayload(type, member, eventConfig, { channelId: channel.id, nowMs: options.nowMs });
  try {
    await channel.send(payload);
    return { sent: true, channelId: channel.id, payload };
  } catch (error) {
    log(`Welcome Messages: ${type} delivery failed in guild ${guildId}: ${error?.message || 'unknown Discord API error'}`);
    return { sent: false, reason: 'send-failed', error };
  }
}

function isNewBoost(oldMember, newMember) {
  return !oldMember?.premiumSinceTimestamp && Boolean(newMember?.premiumSinceTimestamp);
}

function boostDedupeKey(member) {
  const guild = member?.guild || {};
  const userId = String(member?.user?.id || member?.id || 'unknown');
  const boostCount = Math.max(0, Number(guild.premiumSubscriptionCount) || 0);
  return `${guild.id || 'unknown'}:${userId}:${boostCount}`;
}

function reserveBoostAnnouncement(member, nowMs = Date.now()) {
  const cutoff = nowMs - Math.max(BOOST_DEDUPE_WINDOW_MS * 4, 120_000);
  for (const [key, timestamp] of recentBoostAnnouncements) {
    if (timestamp < cutoff) recentBoostAnnouncements.delete(key);
  }
  const key = boostDedupeKey(member);
  const previous = recentBoostAnnouncements.get(key);
  if (previous && nowMs - previous < BOOST_DEDUPE_WINDOW_MS) return null;
  recentBoostAnnouncements.set(key, nowMs);
  return { key, timestamp: nowMs };
}

async function sendDeduplicatedBoost(member, options = {}) {
  const reservation = reserveBoostAnnouncement(member, Number(options.nowMs) || Date.now());
  if (!reservation) return { sent: false, reason: 'duplicate' };
  const result = await sendMemberMessage('boost', member, options);
  if (!result.sent && recentBoostAnnouncements.get(reservation.key) === reservation.timestamp) {
    recentBoostAnnouncements.delete(reservation.key);
  }
  return result;
}

async function handleGuildMemberAdd(member, options = {}) {
  return sendMemberMessage('join', member, options);
}

async function handleGuildMemberRemove(member, options = {}) {
  return sendMemberMessage('leave', member, options);
}

async function handleGuildMemberUpdate(oldMember, newMember, options = {}) {
  if (!isNewBoost(oldMember, newMember)) return { sent: false, reason: 'not-a-new-boost' };
  return sendDeduplicatedBoost(newMember, options);
}

function isBoostSystemMessage(message) {
  return BOOST_SYSTEM_MESSAGE_TYPES.has(message?.type);
}

async function handleBoostSystemMessage(message, options = {}) {
  if (!message?.guild || !isBoostSystemMessage(message)) return { sent: false, reason: 'not-a-boost-message' };
  const userId = String(message.author?.id || message.member?.id || '');
  let member = message.member || message.guild.members?.cache?.get?.(userId) || null;
  if (!member && userId) member = await message.guild.members?.fetch?.(userId).catch(() => null);
  if (!member) {
    (options.log || logCommandSystem)(`Welcome Messages: boost delivery skipped in guild ${message.guild.id} because the boosting member could not be resolved.`);
    return { sent: false, reason: 'missing-member' };
  }
  return sendDeduplicatedBoost(member, options);
}

function resetBoostDeduplication() {
  recentBoostAnnouncements.clear();
}

module.exports = {
  BOOST_DEDUPE_WINDOW_MS,
  BOOST_SYSTEM_MESSAGE_TYPES,
  COMPONENTS_V2_FLAG,
  deliveryPermissions,
  handleBoostSystemMessage,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  handleGuildMemberUpdate,
  humanDuration,
  interpolateTemplate,
  isBoostSystemMessage,
  isNewBoost,
  memberMessagePayload,
  memberMessageValues,
  messageContentComponents,
  resetBoostDeduplication,
  resolvedLayout,
  sendMemberMessage,
};
