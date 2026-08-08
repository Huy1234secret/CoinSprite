const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { readJsonFile, writeJsonAtomic } = require('./jsonFileStore');
const { logCommandSystem } = require('./commandLogger');
const {
  DEFAULT_LEVELING_CONFIG,
  getGuildConfig,
  isGuildLevelingEnabled,
} = require('./serverConfig');

const DATA_PATH = path.join(__dirname, '..', 'data', 'leveling.json');
const LEVEL_CARD_MEDIA_DIR = path.join(__dirname, '..', 'data', 'level-card-media');
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const ACCENT = 0xb9f547;
const PAGE_SIZE = 10;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_DASHBOARD_BASE_URL = 'https://panel.coin-sprite.com';
const CANVAS_FONT_FAMILY = '"Segoe UI Emoji", "Segoe UI Symbol", "Noto Sans", "DejaVu Sans", sans-serif';

let cachedState = null;
let cachedStateMtime = 0;
let lastCheckTime = 0;
let saveTimer = null;
const levelCardAssetCache = new Map();
const avatarImageCache = new Map();
const emojiImageCache = new Map();

function blankState() {
  return { version: 2, guilds: {}, profiles: {} };
}

const DEFAULT_LEVEL_CARD_DESIGN = Object.freeze({
  background: { color: '#111814', imageUrl: '', x: 0, y: 0, scale: 1 },
  panelOpacity: 0.85,
  colors: {
    surface: '#18201b', accent: '#b9f547', text: '#f4f7f2', muted: '#a3ada6',
    track: '#303a33', progress: '#b9f547',
  },
  avatar: { x: 54, y: 68, size: 150, color: '#b9f547' },
  username: { x: 236, y: 70, size: 34, color: '#f4f7f2' },
  level: { x: 236, y: 130, size: 24, color: '#b9f547' },
  rank: { x: 876, y: 68, size: 28, color: '#f4f7f2' },
  xp: { x: 236, y: 269, size: 21, color: '#d8ded9' },
  progress: { x: 236, y: 211, width: 698, height: 27, color: '#b9f547', trackColor: '#303a33' },
  layers: [],
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function safeColor(value, fallback) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

function safeCardMediaUrl(value, userId) {
  let url = String(value || '').trim();
  try {
    if (url.startsWith('http')) url = new URL(url).pathname;
  } catch {}
  const match = url.match(/^\/level-card-media\/(\d{16,20})\/([a-f0-9]{32})\.(png|jpg|webp)$/);
  return match && match[1] === String(userId) ? url : '';
}

function normalizeLevelCardDesign(value, userId) {
  const defaults = cloneJson(DEFAULT_LEVEL_CARD_DESIGN);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const point = (name, limits) => {
    const input = source[name] || {};
    const base = defaults[name];
    const output = {};
    for (const [key, [minimum, maximum]] of Object.entries(limits)) output[key] = clamp(input[key], minimum, maximum, base[key]);
    output.color = safeColor(input.color, base.color);
    return output;
  };
  const design = {
    background: {
      color: safeColor(source.background?.color, defaults.background.color),
      imageUrl: safeCardMediaUrl(source.background?.imageUrl, userId),
      x: clamp(source.background?.x, -1000, 1000, 0),
      y: clamp(source.background?.y, -320, 320, 0),
      scale: clamp(source.background?.scale, 0.25, 5, 1),
    },
    panelOpacity: clamp(source.panelOpacity, 0, 1, defaults.panelOpacity),
    colors: {},
    avatar: point('avatar', { x: [0, 950], y: [0, 270], size: [32, 240] }),
    username: point('username', { x: [0, 980], y: [20, 310], size: [12, 80] }),
    level: point('level', { x: [0, 980], y: [20, 310], size: [12, 60] }),
    rank: point('rank', { x: [0, 980], y: [20, 310], size: [12, 60] }),
    xp: point('xp', { x: [0, 980], y: [20, 310], size: [12, 50] }),
    progress: point('progress', { x: [0, 980], y: [0, 310], width: [40, 950], height: [6, 70] }),
    layers: [],
  };
  for (const key of Object.keys(defaults.colors)) design.colors[key] = safeColor(source.colors?.[key], defaults.colors[key]);
  design.progress.trackColor = safeColor(source.progress?.trackColor, defaults.progress.trackColor);
  design.avatar.x = clamp(design.avatar.x, 0, 1000 - design.avatar.size, defaults.avatar.x);
  design.avatar.y = clamp(design.avatar.y, 0, 320 - design.avatar.size, defaults.avatar.y);
  const textWidths = { username: 390, level: 210, xp: 330 };
  for (const key of ['username', 'level', 'xp']) {
    design[key].x = clamp(design[key].x, 0, 1000 - textWidths[key], defaults[key].x);
    design[key].y = clamp(design[key].y, 0, 320 - design[key].size, defaults[key].y);
  }
  design.rank.x = clamp(design.rank.x, 120, 1000, defaults.rank.x);
  design.rank.y = clamp(design.rank.y, 0, 320 - design.rank.size, defaults.rank.y);
  design.progress.x = clamp(design.progress.x, 0, 1000 - design.progress.width, defaults.progress.x);
  design.progress.y = clamp(design.progress.y, 0, 320 - design.progress.height, defaults.progress.y);
  for (const [index, layer] of (Array.isArray(source.layers) ? source.layers : []).slice(0, 20).entries()) {
    if (!layer || typeof layer !== 'object') continue;
    const base = {
      id: /^[a-z0-9_-]{1,40}$/i.test(String(layer.id || '')) ? String(layer.id) : `layer-${index + 1}`,
      x: clamp(layer.x, -500, 1000, 50), y: clamp(layer.y, -300, 320, 50),
      width: clamp(layer.width, 12, 800, 120), height: clamp(layer.height, 12, 320, 120),
    };
    if (layer.type === 'image') {
      const imageUrl = safeCardMediaUrl(layer.imageUrl, userId);
      if (imageUrl) design.layers.push({
        ...base, type: 'image', imageUrl,
        x: clamp(base.x, 0, 1000 - base.width, 50),
        y: clamp(base.y, 0, 320 - base.height, 50),
      });
    } else if (layer.type === 'text') {
      const size = clamp(layer.size, 10, 96, 28);
      design.layers.push({
        ...base, type: 'text', text: String(layer.text || 'Text').replace(/[\r\n]+/g, ' ').slice(0, 120),
        x: clamp(base.x, 0, 1000 - base.width, 50),
        y: clamp(base.y, 0, 320 - size, 50),
        size, color: safeColor(layer.color, '#f4f7f2'),
        weight: layer.weight === 'normal' ? 'normal' : 'bold',
      });
    }
  }
  return design;
}

function normalizeRecord(value = {}) {
  return {
    xp: Math.max(0, Math.floor(Number(value.xp) || 0)),
    messages: Math.max(0, Math.floor(Number(value.messages) || 0)),
    lastXpAt: Math.max(0, Number(value.lastXpAt) || 0),
    lastMessageAt: Math.max(0, Number(value.lastMessageAt) || 0),
    lastMessageHash: String(value.lastMessageHash || '').slice(0, 64),
    updatedAt: Math.max(0, Number(value.updatedAt) || 0),
  };
}

function normalizeState(value) {
  const state = blankState();
  if (!value || typeof value !== 'object') return state;
  for (const [guildId, guild] of Object.entries(value.guilds || {})) {
    if (!/^\d{16,20}$/.test(guildId)) continue;
    const users = {};
    for (const [userId, record] of Object.entries(guild?.users || {})) {
      if (/^\d{16,20}$/.test(userId)) users[userId] = normalizeRecord(record);
    }
    state.guilds[guildId] = { users };
  }
  for (const [userId, profile] of Object.entries(value.profiles || {})) {
    if (!/^\d{16,20}$/.test(userId)) continue;
    state.profiles[userId] = {
      design: normalizeLevelCardDesign(profile?.design, userId),
      updatedAt: Math.max(0, Number(profile?.updatedAt) || 0),
    };
  }
  return state;
}

function getState() {
  const now = Date.now();
  if (!cachedState || now - lastCheckTime > 2000) {
    lastCheckTime = now;
    try {
      const stat = fs.statSync(DATA_PATH);
      if (stat.mtimeMs > cachedStateMtime || !cachedState) {
        cachedState = normalizeState(readJsonFile(DATA_PATH, { label: 'leveling data', fallback: blankState() }));
        cachedStateMtime = stat.mtimeMs;
      }
    } catch {
      if (!cachedState) cachedState = blankState();
    }
  }
  return cachedState;
}

function flushLevelingState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (cachedState) {
    writeJsonAtomic(DATA_PATH, cachedState);
    try {
      cachedStateMtime = fs.statSync(DATA_PATH).mtimeMs;
    } catch {}
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(flushLevelingState, 750);
  saveTimer.unref?.();
}

function resetLevelingCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  cachedState = null;
  cachedStateMtime = 0;
  lastCheckTime = 0;
}

function guildUsers(guildId) {
  const state = getState();
  state.guilds[guildId] ||= { users: {} };
  return state.guilds[guildId].users;
}

function userRecord(guildId, userId) {
  const users = guildUsers(String(guildId));
  users[userId] ||= normalizeRecord();
  return users[userId];
}

function levelingConfig(guildId) {
  return getGuildConfig(guildId)?.leveling || DEFAULT_LEVELING_CONFIG;
}

function xpThresholdForLevel(level, curve = DEFAULT_LEVELING_CONFIG.curve) {
  const target = Math.max(0, Math.floor(Number(level) || 0));
  if (!target) return 0;
  return Math.floor(Math.max(1, Number(curve.baseXp) || 100) * Math.pow(target, Math.max(1, Number(curve.growth) || 1.5)));
}

function levelForXp(xp, curve = DEFAULT_LEVELING_CONFIG.curve) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  const maximum = Math.max(1, Math.floor(Number(curve.maxLevel) || 100));
  let low = 0;
  let high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (xpThresholdForLevel(middle, curve) <= total) low = middle;
    else high = middle - 1;
  }
  return low;
}

function applyXpToRecord(record, amount, config = DEFAULT_LEVELING_CONFIG, nowMs = Date.now()) {
  const oldXp = record.xp;
  const oldLevel = levelForXp(oldXp, config.curve);
  record.xp = Math.max(0, Math.floor(oldXp + Number(amount || 0)));
  record.updatedAt = nowMs;
  const newLevel = levelForXp(record.xp, config.curve);
  return { amount: record.xp - oldXp, oldXp, newXp: record.xp, oldLevel, newLevel, record };
}

function memberStats(guildId, userId, config = levelingConfig(guildId)) {
  const record = normalizeRecord(guildUsers(String(guildId))[String(userId)] || {});
  const level = levelForXp(record.xp, config.curve);
  const levelStartXp = xpThresholdForLevel(level, config.curve);
  const nextLevelXp = level >= config.curve.maxLevel
    ? levelStartXp
    : xpThresholdForLevel(level + 1, config.curve);
  const progressXp = Math.max(0, record.xp - levelStartXp);
  const neededXp = Math.max(0, nextLevelXp - levelStartXp);
  const leaderboard = sortedLeaderboard(guildId, config);
  const rankIndex = leaderboard.findIndex((entry) => entry.userId === String(userId));
  return {
    ...record,
    level,
    levelStartXp,
    nextLevelXp,
    progressXp,
    neededXp,
    progressRatio: neededXp ? Math.min(1, progressXp / neededXp) : 1,
    rank: rankIndex === -1 ? leaderboard.length + 1 : rankIndex + 1,
  };
}

function sortedLeaderboard(guildId, config = levelingConfig(guildId)) {
  return Object.entries(guildUsers(String(guildId)))
    .map(([userId, record]) => ({ userId, ...normalizeRecord(record), level: levelForXp(record.xp, config.curve) }))
    .sort((left, right) => right.xp - left.xp || right.messages - left.messages || left.userId.localeCompare(right.userId));
}

function progressBar(ratio, width = 12) {
  const filled = Math.max(0, Math.min(width, Math.round((Number(ratio) || 0) * width)));
  return `${'\u25a0'.repeat(filled)}${'\u25a1'.repeat(width - filled)}`;
}

function safeName(value) {
  return String(value || 'Member').replace(/[\\*_~`|>]/g, '\\$&').slice(0, 80);
}

function canvasDisplayName(value) {
  return String(value || 'Member')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\*\*([\s\S]+)\*\*$/u, '$1')
    .trim() || 'Member';
}

function graphemes(value) {
  const text = String(value || '');
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  }
  return Array.from(text);
}

function fitCanvasText(context, value, options = {}) {
  const text = options.displayName === false
    ? String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '')
    : canvasDisplayName(value);
  const weight = options.weight || 'bold';
  const minimum = Math.max(8, Number(options.minimum) || 14);
  let size = Math.max(minimum, Number(options.size) || 30);
  const maximumWidth = Math.max(20, Number(options.maximumWidth) || 500);
  while (size > minimum) {
    context.font = `${weight} ${size}px ${CANVAS_FONT_FAMILY}`;
    if (context.measureText(text).width <= maximumWidth) return { text, size };
    size -= 1;
  }
  context.font = `${weight} ${size}px ${CANVAS_FONT_FAMILY}`;
  if (context.measureText(text).width <= maximumWidth) return { text, size };
  const parts = graphemes(text);
  while (parts.length > 1 && context.measureText(`${parts.join('')}\u2026`).width > maximumWidth) parts.pop();
  return { text: `${parts.join('')}\u2026`, size };
}

function number(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Number(value) || 0));
}

function v2Payload(content, options = {}) {
  const inner = [{ type: 10, content }];
  if (Array.isArray(options.components) && options.components.length) {
    inner.push({ type: 14, divider: true, spacing: 1 }, ...options.components);
  }
  return {
    flags: COMPONENTS_V2_FLAG | (options.ephemeral ? EPHEMERAL_FLAG : 0),
    allowedMentions: options.allowedMentions || { parse: [], users: [], roles: [] },
    components: [{ type: 17, accent_color: options.color || ACCENT, components: inner }],
  };
}

function buildLevelPayload(user, stats) {
  const capped = stats.neededXp === 0;
  const progress = capped ? 'Maximum level reached' : `${number(stats.progressXp)} / ${number(stats.neededXp)} XP`;
  return v2Payload([
    `## \u2726 ${safeName(user?.globalName || user?.displayName || user?.username)}'s level`,
    `-# Rank #${number(stats.rank)} \u00b7 ${number(stats.messages)} eligible messages`,
    '',
    `### Level ${number(stats.level)}`,
    `\`${progressBar(stats.progressRatio)}\` **${progress}**`,
    `-# ${number(stats.xp)} total XP`,
  ].join('\n'));
}

async function leaderboardPage(interaction, page = 1) {
  const config = levelingConfig(interaction.guildId);
  const entries = sortedLeaderboard(interaction.guildId, config);
  const maxPage = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(maxPage, Math.max(1, Math.floor(Number(page) || 1)));
  const start = (currentPage - 1) * PAGE_SIZE;
  const rows = await Promise.all(entries.slice(start, start + PAGE_SIZE).map(async (entry, index) => {
    const member = interaction.guild.members.cache.get(entry.userId)
      || await interaction.guild.members.fetch(entry.userId).catch(() => null);
    return {
      rank: start + index + 1,
      displayName: member?.displayName || member?.user?.globalName || member?.user?.username || `Member ${entry.userId}`,
      user: member?.user || { id: entry.userId, username: `Member ${entry.userId}` },
      level: entry.level,
      xp: entry.xp,
    };
  }));
  const ownerId = interaction.user.id;
  const controls = maxPage > 1 ? [{
    type: 1,
    components: [
      { type: 2, style: 2, label: 'Previous', custom_id: `leveling:leaderboard:${ownerId}:${currentPage - 1}`, disabled: currentPage <= 1 },
      { type: 2, style: 2, label: `Page ${currentPage}/${maxPage}`, custom_id: `leveling:leaderboard:${ownerId}:${currentPage}`, disabled: true },
      { type: 2, style: 2, label: 'Next', custom_id: `leveling:leaderboard:${ownerId}:${currentPage + 1}`, disabled: currentPage >= maxPage },
    ],
  }] : [];
  const image = await renderLeaderboardCard({
    guildName: interaction.guild.name,
    rows,
    page: currentPage,
    maxPage,
    totalMembers: entries.length,
  });
  return buildLeaderboardPayload(image, controls);
}

function dashboardBaseUrl() {
  const configured = String(process.env.PUBLIC_WEB_BASE_URL || '').trim().replace(/\/+$/g, '');
  if (configured) return configured;
  try {
    return new URL(process.env.DISCORD_REDIRECT_URI || '').origin;
  } catch {
    return DEFAULT_DASHBOARD_BASE_URL;
  }
}

function levelCardRenderKey(secret = process.env.LEVEL_CARD_RENDER_SECRET || process.env.DISCORD_CLIENT_SECRET || process.env.SESSION_SECRET) {
  const value = String(secret || '');
  return value ? crypto.createHmac('sha256', value).update('coinsprite-level-card-render-v1').digest('hex') : '';
}

function levelCardRenderOrigin(env = process.env) {
  const configured = String(env.PUBLIC_WEB_BASE_URL || env.ADMIN_PUBLIC_URL || '').trim().replace(/\/+$/g, '');
  for (const candidate of [configured, env.DISCORD_REDIRECT_URI]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (['http:', 'https:'].includes(url.protocol)) return url.origin;
    } catch {}
  }
  return '';
}

function cardAvatarUrl(user) {
  return user?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || user?.avatarURL?.({ extension: 'png', size: 256 })
    || '';
}

async function renderPublishedLevelCard(user, stats, options = {}) {
  const origin = options.origin === undefined ? levelCardRenderOrigin() : String(options.origin || '').replace(/\/+$/g, '');
  const key = options.key === undefined ? levelCardRenderKey() : String(options.key || '');
  const fetchImpl = options.fetchImpl || fetch;
  if (origin && key) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    timeout.unref?.();
    try {
      const response = await fetchImpl(`${origin}/api/internal/level-card/${user.id}`, {
        method: 'POST',
        headers: {
          Accept: 'image/png',
          'Content-Type': 'application/json',
          'X-CoinSprite-Render-Key': key,
        },
        body: JSON.stringify({
          user: {
            username: String(user?.username || '').slice(0, 100),
            globalName: String(user?.globalName || '').slice(0, 100),
            displayName: String(user?.displayName || '').slice(0, 100),
            avatarUrl: cardAvatarUrl(user),
          },
          stats,
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        const image = Buffer.from(await response.arrayBuffer());
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (image.length <= 10 * 1024 * 1024 && image.subarray(0, png.length).equals(png)) return image;
      }
    } catch {
      // The local renderer keeps /level available during dashboard maintenance.
    } finally {
      clearTimeout(timeout);
    }
  }
  return renderLevelCard(user, stats);
}

function messageFingerprint(message) {
  const content = String(message.content || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 1000);
  const attachments = [...(message.attachments?.values?.() || [])]
    .map((attachment) => `${attachment.name || ''}:${attachment.size || ''}`)
    .join('|');
  if (content.length < 3 && !attachments) return '';
  return crypto.createHash('sha256').update(`${content}|${attachments}`).digest('hex');
}

function randomXp(config) {
  const minimum = Math.max(1, Math.floor(config.xp.min));
  const maximum = Math.max(minimum, Math.floor(config.xp.max));
  return crypto.randomInt(minimum, maximum + 1);
}

function xpMultiplierForMessage(message, config) {
  const multipliers = config.channelMultipliers || {};
  const channelId = String(message.channelId || '');
  const parentId = String(message.channel?.parentId || '');
  const hasChannel = Object.prototype.hasOwnProperty.call(multipliers, channelId);
  const hasParent = parentId && Object.prototype.hasOwnProperty.call(multipliers, parentId);
  const channelMultiplier = Math.max(0, Math.min(10, Number(hasChannel ? multipliers[channelId] : hasParent ? multipliers[parentId] : 0) || 0));
  if (!channelMultiplier) return { channelMultiplier, roleMultiplier: 1, multiplier: 0 };

  const memberRoles = message.member?.roles?.cache;
  const matchingRoleBoosts = (config.roleBoosts || [])
    .filter((boost) => memberRoles?.has?.(boost.roleId))
    .map((boost) => Math.max(0, Math.min(10, Number(boost.multiplier) || 0)));
  const roleMultiplier = matchingRoleBoosts.length ? Math.max(...matchingRoleBoosts) : 1;
  return {
    channelMultiplier,
    roleMultiplier,
    multiplier: Math.min(10, channelMultiplier * roleMultiplier),
  };
}

function processMessageXp(message, options = {}) {
  const config = options.config || levelingConfig(message.guildId);
  const nowMs = Number(options.nowMs) || Date.now();
  if (!config.enabled || message.author?.bot || message.webhookId || message.system) return { awarded: false, reason: 'ineligible' };
  const multipliers = xpMultiplierForMessage(message, config);
  if (!multipliers.multiplier) return { awarded: false, reason: 'xp-disabled-channel', ...multipliers };
  const fingerprint = options.fingerprint || messageFingerprint(message);
  if (!fingerprint) return { awarded: false, reason: 'empty' };
  const record = userRecord(message.guildId, message.author.id);
  if (record.lastMessageAt && record.lastMessageHash === fingerprint && nowMs - record.lastMessageAt < DUPLICATE_WINDOW_MS) {
    return { awarded: false, reason: 'duplicate', record };
  }
  record.lastMessageHash = fingerprint;
  record.lastMessageAt = nowMs;
  record.messages += 1;
  record.updatedAt = nowMs;
  const cooldownMs = Math.max(5, Number(config.xp.cooldownSeconds) || 60) * 1000;
  if (record.lastXpAt && nowMs - record.lastXpAt < cooldownMs) {
    scheduleSave();
    return { awarded: false, reason: 'cooldown', record };
  }
  record.lastXpAt = nowMs;
  const baseAmount = options.amount ?? randomXp(config);
  const result = applyXpToRecord(record, Math.floor(baseAmount * multipliers.multiplier), config, nowMs);
  scheduleSave();
  return { awarded: result.amount > 0, reason: 'awarded', ...multipliers, ...result };
}

async function syncRewardRoles(guild, userId, level, config = levelingConfig(guild.id)) {
  const rewards = config.roleRewards.filter((reward) => reward.level <= level);
  if (!rewards.length) return;
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  const desired = config.stackRoleRewards ? rewards : [rewards.at(-1)];
  const desiredIds = new Set(desired.map((reward) => reward.roleId));
  const rewardIds = new Set(config.roleRewards.map((reward) => reward.roleId));
  const add = [...desiredIds].filter((roleId) => !member.roles.cache.has(roleId));
  const remove = [...rewardIds].filter((roleId) => member.roles.cache.has(roleId) && !desiredIds.has(roleId));
  if (add.length) await member.roles.add(add, `CoinSprite level ${level} reward`).catch((error) => logCommandSystem(`Level reward add failed in ${guild.id}: ${error?.message || 'unknown error'}`));
  if (remove.length) await member.roles.remove(remove, `CoinSprite level ${level} reward update`).catch((error) => logCommandSystem(`Level reward cleanup failed in ${guild.id}: ${error?.message || 'unknown error'}`));
}

function announcementText(template, message, level, values = {}) {
  let userProfile = '';
  try {
    userProfile = String(message.author?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '');
  } catch {}
  const tokens = {
    user: `<@${message.author.id}>`,
    user_profile: userProfile,
    username: safeName(message.member?.displayName || message.author.username),
    level: String(level),
    next_level: String(values.nextLevel ?? level + 1),
    server: safeName(message.guild.name),
    bar: String(values.bar || ''),
    progress_xp: String(values.progressXp ?? 0),
    needed_xp: String(values.neededXp ?? 0),
    total_xp: String(values.totalXp ?? 0),
  };
  let output = String(template || '');
  for (const [key, value] of Object.entries(tokens)) output = output.replaceAll(`{${key}}`, value);
  return output;
}

function safeMediaUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function bestMemberStats(userId) {
  let best = null;
  for (const guildId of Object.keys(getState().guilds)) {
    const stats = memberStats(guildId, userId);
    if (!best || stats.xp > best.xp) best = { guildId, ...stats };
  }
  const neededXp = xpThresholdForLevel(1, DEFAULT_LEVELING_CONFIG.curve);
  return best || {
    guildId: '', xp: 0, messages: 0, level: 0, levelStartXp: 0, nextLevelXp: neededXp,
    progressXp: 0, neededXp, progressRatio: 0, rank: 1,
  };
}

function getLevelCardDesign(userId) {
  const profile = getState().profiles[String(userId)];
  return normalizeLevelCardDesign(profile?.design, userId);
}

function saveLevelCardDesign(userId, value) {
  const id = String(userId);
  if (!/^\d{16,20}$/.test(id)) throw new Error('A valid Discord user is required.');
  const design = normalizeLevelCardDesign(value, id);
  getState().profiles[id] = { design, updatedAt: Date.now() };
  flushLevelingState();

  try {
    const directory = path.join(LEVEL_CARD_MEDIA_DIR, id);
    if (fs.existsSync(directory)) {
      const usedImages = new Set();
      if (design.background?.imageUrl) {
        const bgMatch = design.background.imageUrl.match(/\/([a-f0-9]{32}\.(?:png|jpg|webp))$/);
        if (bgMatch) usedImages.add(bgMatch[1]);
      }
      for (const layer of design.layers || []) {
        if (layer.type === 'image' && layer.imageUrl) {
          const layerMatch = layer.imageUrl.match(/\/([a-f0-9]{32}\.(?:png|jpg|webp))$/);
          if (layerMatch) usedImages.add(layerMatch[1]);
        }
      }
      const files = fs.readdirSync(directory);
      for (const file of files) {
        if (!usedImages.has(file)) {
          try {
            fs.unlinkSync(path.join(directory, file));
          } catch {}
        }
      }
    }
  } catch (error) {
    console.error('Failed to cleanup level card media:', error);
  }

  return design;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

async function loadLocalCardImage(url, userId) {
  const safe = safeCardMediaUrl(url, userId);
  if (!safe) return null;
  const match = safe.match(/^\/level-card-media\/(\d{16,20})\/([a-f0-9]{32})\.(png|jpg|webp)$/);
  const filePath = path.join(LEVEL_CARD_MEDIA_DIR, match[1], `${match[2]}.${match[3]}`);
  let fingerprint;
  try {
    const metadata = fs.statSync(filePath);
    fingerprint = `${metadata.size}:${metadata.mtimeMs}`;
  } catch {
    levelCardAssetCache.delete(safe);
    return null;
  }
  const cached = levelCardAssetCache.get(safe);
  if (cached?.fingerprint === fingerprint) return cached.loading;
  const loading = Promise.resolve().then(() => loadImage(fs.readFileSync(filePath))).catch(() => null);
  const entry = { fingerprint, loading };
  levelCardAssetCache.set(safe, entry);
  if (levelCardAssetCache.size > 200) levelCardAssetCache.delete(levelCardAssetCache.keys().next().value);
  const image = await loading;
  if (!image && levelCardAssetCache.get(safe) === entry) levelCardAssetCache.delete(safe);
  return image;
}

async function loadDiscordAvatar(user) {
  const url = user?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || user?.avatarURL?.({ extension: 'png', size: 256 });
  if (!/^https:\/\/cdn\.discordapp\.com\//i.test(String(url || ''))) return null;
  const cached = avatarImageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.loading;
  const loading = (async () => {
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 5 * 1024 * 1024) return null;
      return await loadImage(body);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  avatarImageCache.set(url, { expiresAt: Date.now() + 5 * 60 * 1000, loading });
  if (avatarImageCache.size > 100) avatarImageCache.delete(avatarImageCache.keys().next().value);
  return loading;
}

function leadingFlagParts(value) {
  const displayName = canvasDisplayName(value);
  const match = displayName.match(/^([\u{1F1E6}-\u{1F1FF}]{2})\s*(.*)$/u);
  if (!match) return { flag: '', countryCode: '', text: displayName };
  const points = Array.from(match[1], (character) => character.codePointAt(0));
  return {
    flag: match[1],
    countryCode: points.map((point) => String.fromCharCode(65 + point - 0x1f1e6)).join(''),
    text: match[2],
  };
}

async function loadFlagEmoji(flag) {
  if (!flag) return null;
  const asset = Array.from(flag, (character) => character.codePointAt(0).toString(16)).join('-');
  if (emojiImageCache.has(asset)) return emojiImageCache.get(asset);
  const loading = (async () => {
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${asset}.png`, { signal: controller.signal });
      if (!response.ok) return null;
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length || body.length > 256 * 1024) return null;
      return await loadImage(body);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  emojiImageCache.set(asset, loading);
  if (emojiImageCache.size > 50) emojiImageCache.delete(emojiImageCache.keys().next().value);
  return loading;
}

async function drawCanvasDisplayName(context, value, x, y, options = {}) {
  const parts = leadingFlagParts(value);
  const requestedSize = Math.max(10, Number(options.size) || 30);
  let textX = x;
  let maximumWidth = Math.max(30, Number(options.maximumWidth) || 500);
  const isTop = context.textBaseline === 'top';
  if (parts.flag) {
    const flagHeight = Math.round(requestedSize * .9);
    const flagWidth = Math.round(flagHeight * 1.33);
    const image = await loadFlagEmoji(parts.flag);
    if (image) context.drawImage(image, x, y + (isTop ? 0 : -requestedSize * .8) + Math.round((requestedSize - flagHeight) / 2), flagWidth, flagHeight);
    else {
      const previousFill = context.fillStyle;
      context.fillStyle = '#263129';
      roundedRect(context, x, y + (isTop ? 2 : -requestedSize * .8 + 2), flagWidth, Math.max(18, flagHeight - 2), 6);
      context.fill();
      context.fillStyle = previousFill;
      context.textAlign = 'center';
      context.font = `bold ${Math.max(10, Math.round(requestedSize * .38))}px ${CANVAS_FONT_FAMILY}`;
      context.fillText(parts.countryCode, x + flagWidth / 2, y + (isTop ? 0 : -requestedSize * .8) + requestedSize * .68);
      context.textAlign = 'left';
    }
    textX += flagWidth + 10;
    maximumWidth -= flagWidth + 10;
  }
  if (!parts.text) return;
  const fitted = fitCanvasText(context, parts.text, { ...options, maximumWidth });
  context.fillText(fitted.text, textX, isTop ? y : y + fitted.size);
}

const PODIUM_COLORS = Object.freeze({
  1: { main: '#f6c945', soft: 'rgba(246, 201, 69, .14)', label: '1ST' },
  2: { main: '#c6ced8', soft: 'rgba(198, 206, 216, .12)', label: '2ND' },
  3: { main: '#d58a52', soft: 'rgba(213, 138, 82, .13)', label: '3RD' },
});

async function renderLeaderboardCard(options = {}) {
  const rows = Array.isArray(options.rows) ? options.rows.slice(0, PAGE_SIZE) : [];
  const rowCount = Math.max(1, rows.length);
  const width = 1000;
  const height = 205 + rowCount * 82 + 54;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const avatars = await Promise.all(rows.map((row) => loadDiscordAvatar(row.user)));

  context.fillStyle = '#0b100d';
  roundedRect(context, 0, 0, width, height, 30);
  context.fill();
  context.save();
  roundedRect(context, 0, 0, width, height, 30);
  context.clip();
  const glow = context.createRadialGradient(80, 40, 0, 80, 40, 480);
  glow.addColorStop(0, 'rgba(185, 245, 71, .14)');
  glow.addColorStop(1, 'rgba(185, 245, 71, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#b9f547';
  roundedRect(context, 42, 38, 9, 88, 5);
  context.fill();
  context.fillStyle = '#f4f7f2';
  const guildTitle = fitCanvasText(context, options.guildName || 'Server', { size: 42, minimum: 24, maximumWidth: 700 });
  context.fillText(guildTitle.text, 78, 52 + guildTitle.size);
  context.fillStyle = '#98a39c';
  context.font = `18px ${CANVAS_FONT_FAMILY}`;
  context.fillText(`${number(options.totalMembers)} ranked members`, 80, 124);
  context.textAlign = 'right';
  context.fillStyle = '#b9f547';
  context.font = `bold 18px ${CANVAS_FONT_FAMILY}`;
  context.fillText('COINSPRITE LEADERBOARD', 946, 64);
  context.fillStyle = '#77837b';
  context.font = `15px ${CANVAS_FONT_FAMILY}`;
  context.fillText('Ranked by total XP', 946, 94);

  if (!rows.length) {
    context.textAlign = 'center';
    context.fillStyle = '#171e1a';
    roundedRect(context, 42, 165, 916, 82, 18);
    context.fill();
    context.fillStyle = '#98a39c';
    context.font = `20px ${CANVAS_FONT_FAMILY}`;
    context.fillText('No one has earned XP yet.', 500, 215);
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const y = 165 + index * 82;
    const podium = PODIUM_COLORS[row.rank];
    context.fillStyle = podium?.soft || 'rgba(255, 255, 255, .035)';
    roundedRect(context, 42, y, 916, 70, 17);
    context.fill();
    context.strokeStyle = podium?.main || 'rgba(236, 255, 246, .09)';
    context.lineWidth = podium ? 2 : 1;
    roundedRect(context, 42, y, 916, 70, 17);
    context.stroke();

    context.fillStyle = podium?.main || '#27312b';
    roundedRect(context, 56, y + 10, 54, 50, 13);
    context.fill();
    context.textAlign = 'center';
    context.fillStyle = podium ? '#11160f' : '#b8c2bc';
    context.font = `bold ${row.rank < 100 ? 22 : 17}px ${CANVAS_FONT_FAMILY}`;
    context.fillText(`#${number(row.rank)}`, 83, y + 43);

    const avatarX = 126;
    const avatarY = y + 9;
    const avatarSize = 52;
    context.save();
    context.fillStyle = podium?.main || '#b9f547';
    roundedRect(context, avatarX - 3, avatarY - 3, avatarSize + 6, avatarSize + 6, 29);
    context.fill();
    roundedRect(context, avatarX, avatarY, avatarSize, avatarSize, 26);
    context.clip();
    if (avatars[index]) context.drawImage(avatars[index], avatarX, avatarY, avatarSize, avatarSize);
    else {
      context.fillStyle = '#253029';
      context.fillRect(avatarX, avatarY, avatarSize, avatarSize);
      context.fillStyle = '#f4f7f2';
      context.textAlign = 'center';
      context.font = `bold 23px ${CANVAS_FONT_FAMILY}`;
      context.fillText(graphemes(canvasDisplayName(row.displayName))[0]?.toUpperCase() || '?', avatarX + avatarSize / 2, avatarY + 35);
    }
    context.restore();

    context.textAlign = 'left';
    context.fillStyle = podium?.main || '#f4f7f2';
    await drawCanvasDisplayName(context, row.displayName, 198, y + 12, { size: 25, minimum: 16, maximumWidth: 410 });
    if (podium) {
      context.fillStyle = podium.main;
      context.font = `bold 11px ${CANVAS_FONT_FAMILY}`;
      context.fillText(podium.label, 198, y + 56);
    }

    context.textAlign = 'left';
    context.fillStyle = '#98a39c';
    context.font = `14px ${CANVAS_FONT_FAMILY}`;
    context.fillText('LEVEL', 665, y + 25);
    context.fillStyle = '#f4f7f2';
    context.font = `bold 23px ${CANVAS_FONT_FAMILY}`;
    context.fillText(number(row.level), 665, y + 52);
    context.textAlign = 'right';
    context.fillStyle = '#98a39c';
    context.font = `14px ${CANVAS_FONT_FAMILY}`;
    context.fillText('TOTAL XP', 932, y + 25);
    context.fillStyle = '#f4f7f2';
    context.font = `bold 23px ${CANVAS_FONT_FAMILY}`;
    context.fillText(number(row.xp), 932, y + 52);
  }

  context.textAlign = 'center';
  context.fillStyle = '#68736c';
  context.font = `14px ${CANVAS_FONT_FAMILY}`;
  context.fillText(`PAGE ${number(options.page || 1)} OF ${number(options.maxPage || 1)}`, 500, height - 24);
  context.restore();
  return canvas.toBuffer('image/png');
}

function buildLeaderboardPayload(image, controls = []) {
  return {
    content: null,
    allowedMentions: { parse: [], users: [], roles: [] },
    attachments: [],
    files: [{ attachment: image, name: 'leaderboard.png' }],
    components: controls,
  };
}

function drawCover(context, image, x, y, width, height, offsetX = 0, offsetY = 0, scale = 1) {
  const base = Math.max(width / image.width, height / image.height) * scale;
  const drawWidth = image.width * base;
  const drawHeight = image.height * base;
  context.drawImage(image, x + (width - drawWidth) / 2 + offsetX, y + (height - drawHeight) / 2 + offsetY, drawWidth, drawHeight);
}

async function renderLevelCard(user, stats, inputDesign = getLevelCardDesign(user?.id)) {
  const userId = String(user?.id || '');
  const design = normalizeLevelCardDesign(inputDesign, userId);
  const canvas = createCanvas(1000, 320);
  const context = canvas.getContext('2d');
  context.fillStyle = design.background.color;
  roundedRect(context, 0, 0, 1000, 320, 30);
  context.fill();
  context.save();
  roundedRect(context, 0, 0, 1000, 320, 30);
  context.clip();
  const background = await loadLocalCardImage(design.background.imageUrl, userId);
  if (background) drawCover(context, background, 0, 0, 1000, 320, design.background.x, design.background.y, design.background.scale);
  context.restore();
  context.globalAlpha = design.panelOpacity;
  context.fillStyle = design.colors.surface;
  roundedRect(context, 28, 28, 944, 264, 24);
  context.fill();
  context.globalAlpha = 1;

  const avatar = await loadDiscordAvatar(user);
  context.save();
  roundedRect(context, design.avatar.x - 5, design.avatar.y - 5, design.avatar.size + 10, design.avatar.size + 10, design.avatar.size / 2);
  context.fillStyle = design.avatar.color;
  context.fill();
  roundedRect(context, design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size, design.avatar.size / 2);
  context.clip();
  if (avatar) context.drawImage(avatar, design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size);
  else {
    context.fillStyle = design.colors.track;
    context.fillRect(design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size);
    context.fillStyle = design.colors.text;
    context.font = `bold ${Math.round(design.avatar.size * .45)}px ${CANVAS_FONT_FAMILY}`;
    context.textAlign = 'center';
    context.fillText(graphemes(canvasDisplayName(user?.username || '?'))[0]?.toUpperCase() || '?', design.avatar.x + design.avatar.size / 2, design.avatar.y + design.avatar.size * .67);
  }
  context.restore();

  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillStyle = design.username.color;
  await drawCanvasDisplayName(context, user?.displayName || user?.globalName || user?.username, design.username.x, design.username.y, {
    size: design.username.size,
    minimum: 16,
    maximumWidth: Math.max(120, design.rank.x - design.username.x - 145),
  });
  context.fillStyle = design.level.color;
  context.font = `bold ${design.level.size}px ${CANVAS_FONT_FAMILY}`;
  context.fillText(`LEVEL ${number(stats.level)}`, design.level.x, design.level.y);
  context.textAlign = 'right';
  context.fillStyle = design.rank.color;
  context.font = `bold ${design.rank.size}px ${CANVAS_FONT_FAMILY}`;
  context.fillText(`#${number(stats.rank)}`, design.rank.x, design.rank.y);

  roundedRect(context, design.progress.x, design.progress.y, design.progress.width, design.progress.height, design.progress.height / 2);
  context.fillStyle = design.progress.trackColor;
  context.fill();
  const filled = Math.max(0, design.progress.width * Math.min(1, Number(stats.progressRatio) || 0));
  if (filled > 0) {
    roundedRect(context, design.progress.x, design.progress.y, filled, design.progress.height, design.progress.height / 2);
    context.fillStyle = design.progress.color;
    context.fill();
  }
  context.textAlign = 'left';
  context.fillStyle = design.xp.color;
  context.font = `${design.xp.size}px ${CANVAS_FONT_FAMILY}`;
  const xpLabel = stats.neededXp ? `${number(stats.progressXp)} / ${number(stats.neededXp)} XP` : `${number(stats.xp)} XP - MAX LEVEL`;
  context.fillText(xpLabel, design.xp.x, design.xp.y);

  for (const layer of design.layers) {
    if (layer.type === 'image') {
      const image = await loadLocalCardImage(layer.imageUrl, userId);
      if (image) context.drawImage(image, layer.x, layer.y, layer.width, layer.height);
    } else {
      context.textAlign = 'left';
      context.fillStyle = layer.color;
      const fittedLayer = fitCanvasText(context, layer.text, {
        displayName: false,
        weight: layer.weight,
        size: layer.size,
        minimum: 10,
        maximumWidth: Math.min(1000 - layer.x, layer.width),
      });
      context.fillText(fittedLayer.text, layer.x, layer.y);
    }
  }
  context.restore();
  return canvas.toBuffer('image/png');
}

function buildLevelCardPayload(user, stats, image) {
  return {
    content: null,
    allowedMentions: { parse: [], users: [], roles: [] },
    attachments: [],
    files: [{ attachment: image, name: 'level-card.png' }],
    components: [profileEditButtonRow()],
  };
}

function profileEditButtonRow() {
  return {
    type: 1,
    components: [{ type: 2, style: 5, label: 'Edit card here!', url: `${dashboardBaseUrl()}/profile` }],
  };
}

function resolvedAnnouncementLayout(layout = {}, message, level, values = {}) {
  return {
    ...layout,
    thumbnailUrl: announcementText(layout.thumbnailUrl, message, level, values),
    galleryUrls: (layout.galleryUrls || []).map((url) => announcementText(url, message, level, values)),
  };
}

function accentColorValue(value) {
  const hex = String(value || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : ACCENT;
}

function announcementContentComponents(content, layout = {}) {
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
        accessory: { type: 11, media: { url: thumbnailUrl }, description: 'Level-up thumbnail' },
      });
      thumbnailPlaced = true;
    } else components.push({ type: 10, content: text });
  }

  if (!components.length) components.push({ type: 10, content: '-# Level up' });
  if (thumbnailUrl && !thumbnailPlaced) {
    const first = components.shift();
    components.unshift({
      type: 9,
      components: [first.type === 10 ? first : { type: 10, content: '-# Level up' }],
      accessory: { type: 11, media: { url: thumbnailUrl }, description: 'Level-up thumbnail' },
    });
  }

  const galleryUrls = [...new Set((layout.galleryUrls || []).map(safeMediaUrl).filter(Boolean))].slice(0, 10);
  if (galleryUrls.length) {
    components.push({
      type: 12,
      items: galleryUrls.map((url) => ({ media: { url }, description: 'Level-up image' })),
    });
  }
  return components;
}

function levelUpAnnouncementPayload(content, config) {
  const layout = config.announcements?.layout || {};
  const inner = announcementContentComponents(content, layout);
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [], users: [], roles: [] },
    components: layout.container === false ? inner : [{
      type: 17,
      accent_color: accentColorValue(layout.accentColor),
      components: inner,
    }],
  };
}

async function announceLevelUp(message, result, config) {
  if (!config.announcements.enabled) return;
  const channel = config.announcements.channelId
    ? message.guild.channels.cache.get(config.announcements.channelId)
      || await message.guild.channels.fetch(config.announcements.channelId).catch(() => null)
    : message.channel;
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return;
  const stats = memberStats(message.guildId, message.author.id, config);
  const templateValues = {
    nextLevel: Math.min(config.curve.maxLevel, result.newLevel + 1),
    bar: progressBar(stats.neededXp ? stats.progressRatio : 1),
    progressXp: number(stats.progressXp),
    neededXp: number(stats.neededXp),
    totalXp: number(stats.xp),
  };
  const content = announcementText(config.announcements.template, message, result.newLevel, templateValues);
  const layout = config.announcements?.layout || {};
  const resolvedConfig = {
    ...config,
    announcements: {
      ...config.announcements,
      layout: resolvedAnnouncementLayout(layout, message, result.newLevel, templateValues),
    },
  };
  const payload = levelUpAnnouncementPayload(content, resolvedConfig);
  payload.allowedMentions.users = [message.author.id];
  await channel.send(payload).catch((error) => logCommandSystem(`Level-up announcement failed in ${message.guildId}: ${error?.message || 'unknown error'}`));
}

async function handleLevelingMessage(message) {
  if (!message.guildId || !isGuildLevelingEnabled(message.guildId)) return false;
  const config = levelingConfig(message.guildId);
  const result = processMessageXp(message, { config });
  if (!result.awarded || result.newLevel <= result.oldLevel) return result.awarded;
  await syncRewardRoles(message.guild, message.author.id, result.newLevel, config);
  await announceLevelUp(message, result, config);
  logCommandSystem(`Leveling: ${message.author.id} reached level ${result.newLevel} in guild ${message.guildId}.`);
  return true;
}

async function executeLevel(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  await interaction.reply({
    content: `Building ${safeName(user?.globalName || user?.username)}'s level card...`,
    allowedMentions: { parse: [], users: [], roles: [] },
  });
  const stats = memberStats(interaction.guildId, user.id);
  try {
    let member = interaction.guild?.members?.cache?.get?.(user.id) || null;
    if (!member && typeof interaction.guild?.members?.fetch === 'function') {
      member = await interaction.guild.members.fetch(user.id).catch(() => null);
    }
    const identity = {
      id: user.id,
      username: user.username,
      globalName: user.globalName,
      displayName: member?.displayName || user.globalName || user.username,
      displayAvatarURL: (options) => member?.displayAvatarURL?.(options) || user.displayAvatarURL?.(options),
      avatarURL: (options) => user.avatarURL?.(options),
    };
    const image = await renderPublishedLevelCard(identity, stats);
    await interaction.editReply(buildLevelCardPayload(identity, stats, image));
  } catch (error) {
    logCommandSystem(`Level card render failed for ${user.id}: ${error?.message || 'unknown error'}`);
    await interaction.editReply({
      content: `**${safeName(user?.globalName || user?.username)}** \u00b7 Level **${number(stats.level)}** \u00b7 Rank **#${number(stats.rank)}**\n${number(stats.progressXp)} / ${number(stats.neededXp)} XP`,
      components: [profileEditButtonRow()],
      attachments: [],
      files: [],
      allowedMentions: { parse: [], users: [], roles: [] },
    });
  }
}

async function executeLeaderboard(interaction) {
  await interaction.reply({ content: 'Building the leaderboard...', allowedMentions: { parse: [], users: [], roles: [] } });
  try {
    await interaction.editReply(await leaderboardPage(interaction, interaction.options.getInteger('page') || 1));
  } catch (error) {
    logCommandSystem(`Leaderboard render failed in ${interaction.guildId}: ${error?.message || 'unknown error'}`);
    await interaction.editReply({ content: 'The leaderboard could not be rendered right now.', components: [], attachments: [], files: [] });
  }
}

async function executeLevelSet(interaction) {
  const user = interaction.options.getUser('user', true);
  const level = interaction.options.getInteger('level', true);
  const config = levelingConfig(interaction.guildId);
  const record = userRecord(interaction.guildId, user.id);
  const oldLevel = levelForXp(record.xp, config.curve);
  const targetLevel = Math.min(level, config.curve.maxLevel);
  record.xp = xpThresholdForLevel(targetLevel, config.curve);
  record.updatedAt = Date.now();
  scheduleSave();
  await syncRewardRoles(interaction.guild, user.id, targetLevel, config);
  await interaction.reply(v2Payload(`## Level updated\n**${safeName(user.username)}** moved from level ${oldLevel} to **level ${targetLevel}**.`, { ephemeral: true }));
}

async function executeXpAdd(interaction) {
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const config = levelingConfig(interaction.guildId);
  const result = applyXpToRecord(userRecord(interaction.guildId, user.id), amount, config);
  scheduleSave();
  await syncRewardRoles(interaction.guild, user.id, result.newLevel, config);
  await interaction.reply(v2Payload(`## XP added\n**${safeName(user.username)}** received **${number(amount)} XP** and is now level **${result.newLevel}**.`, { ephemeral: true }));
}

async function executeSetup(interaction) {
  await interaction.reply(v2Payload([
    '## \u219f Leveling setup',
    'Configure XP pacing, announcements, ignored channels, and reward roles in the dashboard.',
    `-# Server ID: ${interaction.guildId}`,
  ].join('\n'), {
    ephemeral: true,
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Open Leveling dashboard', url: `${dashboardBaseUrl()}/admin` }],
    }],
  }));
}

const LEVELING_COMMANDS = [
  {
    data: new SlashCommandBuilder()
      .setName('level')
      .setDescription('Show a member level and XP progress.')
      .addUserOption((option) => option.setName('user').setDescription('Member to view')),
    execute: executeLevel,
  },
  {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show the server XP leaderboard.')
      .addIntegerOption((option) => option.setName('page').setDescription('Leaderboard page').setMinValue(1)),
    execute: executeLeaderboard,
  },
  {
    data: new SlashCommandBuilder()
      .setName('level-set')
      .setDescription('Set a member level.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption((option) => option.setName('user').setDescription('Member to update').setRequired(true))
      .addIntegerOption((option) => option.setName('level').setDescription('New level').setMinValue(0).setMaxValue(1000).setRequired(true)),
    execute: executeLevelSet,
  },
  {
    data: new SlashCommandBuilder()
      .setName('xp-add')
      .setDescription('Add XP to a member.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption((option) => option.setName('user').setDescription('Member to reward').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('XP amount').setMinValue(1).setMaxValue(1000000).setRequired(true)),
    execute: executeXpAdd,
  },
  {
    data: new SlashCommandBuilder()
      .setName('leveling-setup')
      .setDescription('Open the Leveling dashboard.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    execute: executeSetup,
  },
];

const commandMap = new Map(LEVELING_COMMANDS.map((command) => [command.data.name, command]));
const ADMIN_COMMAND_NAMES = new Set(['level-set', 'xp-add', 'leveling-setup']);

async function handleLevelingInteraction(interaction) {
  if (interaction.isChatInputCommand?.()) {
    const command = commandMap.get(interaction.commandName);
    if (!command) return false;
    if (ADMIN_COMMAND_NAMES.has(interaction.commandName) && !interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply(v2Payload('## Manage Server required\nYou do not have permission to use this Leveling command.', { ephemeral: true }));
      return true;
    }
    if (!isGuildLevelingEnabled(interaction.guildId)) {
      const locked = getGuildConfig(interaction.guildId)?.features?.leveling !== true;
      await interaction.reply(v2Payload(locked
        ? '## Leveling is locked\nThe bot owner must unlock this feature for the server.'
        : '## Leveling is paused\nAn administrator can enable it from the dashboard.', { ephemeral: true }));
      return true;
    }
    await command.execute(interaction);
    return true;
  }
  if (interaction.isButton?.() && interaction.customId.startsWith('leveling:leaderboard:')) {
    const [, , ownerId, page] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
      await interaction.reply(v2Payload('These leaderboard controls belong to another member.', { ephemeral: true }));
      return true;
    }
    await interaction.deferUpdate();
    try {
      await interaction.editReply(await leaderboardPage(interaction, page));
    } catch (error) {
      logCommandSystem(`Leaderboard page render failed in ${interaction.guildId}: ${error?.message || 'unknown error'}`);
      await interaction.editReply({ content: 'That leaderboard page could not be rendered right now.', components: [], attachments: [], files: [] });
    }
    return true;
  }
  return false;
}

module.exports = {
  COMPONENTS_V2_FLAG,
  DATA_PATH,
  DEFAULT_LEVEL_CARD_DESIGN,
  LEVEL_CARD_MEDIA_DIR,
  LEVELING_COMMANDS,
  announcementText,
  applyXpToRecord,
  bestMemberStats,
  buildLeaderboardPayload,
  buildLevelCardPayload,
  buildLevelPayload,
  canvasDisplayName,
  flushLevelingState,
  getLevelCardDesign,
  handleLevelingInteraction,
  handleLevelingMessage,
  leaderboardPage,
  levelUpAnnouncementPayload,
  levelForXp,
  memberStats,
  normalizeLevelCardDesign,
  processMessageXp,
  progressBar,
  resolvedAnnouncementLayout,
  resetLevelingCache,
  renderLeaderboardCard,
  levelCardRenderOrigin,
  renderLevelCard,
  renderPublishedLevelCard,
  saveLevelCardDesign,
  levelCardRenderKey,
  sortedLeaderboard,
  xpThresholdForLevel,
  xpMultiplierForMessage,
};
