const fs = require('fs');
const { cleanupGeneratedFiles } = require('./fileCleanup');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const { loadState, saveState, ensureGuildState, ensureUserState } = require('./levelingStore');
const { formatCompactNumber } = require('./numberFormat');
const { logXpEarn } = require('./xpLogger');
const { DEFAULT_GUILD_CONFIG, getGuildConfig } = require('./serverConfig');

const CARD_CACHE_DIR = path.join(__dirname, '..', 'data', 'level-cards');
const LEADERBOARD_CACHE_DIR = path.join(__dirname, '..', 'data', 'leaderboards');
const LEVEL_CARD_CUSTOMIZATION_PATH = path.join(__dirname, '..', 'data', 'level-card-customizations.json');
const USER_CARD_BACKGROUND_DIR = path.join(__dirname, '..', 'User card background');
const LEVEL_CARD_BG_FILENAME = 'Level card background.png';

const PUNISHMENT_DURATIONS_MS = DEFAULT_GUILD_CONFIG.xp.punishmentDurationsMs;

function getPunishmentDurationsMs(guildId) {
  return (getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG).xp.punishmentDurationsMs || PUNISHMENT_DURATIONS_MS;
}

function getMessageXpRoll(guildId, options = {}) {
  const xpConfig = (getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG).xp;
  const min = Math.max(0, Number(options.minXp ?? xpConfig.messageXpMin) || 0);
  const max = Math.max(min, Number(options.maxXp ?? xpConfig.messageXpMax) || min);
  const minTenths = Math.round(min * 10);
  const maxTenths = Math.round(max * 10);
  return (Math.floor(Math.random() * (maxTenths - minTenths + 1)) + minTenths) / 10;
}

function loadCardCustomizations() {
  try {
    if (!fs.existsSync(LEVEL_CARD_CUSTOMIZATION_PATH)) return { users: {} };
    const parsed = JSON.parse(fs.readFileSync(LEVEL_CARD_CUSTOMIZATION_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { users: {} };
    if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
    return parsed;
  } catch {
    return { users: {} };
  }
}

function saveCardCustomizations(state) {
  fs.mkdirSync(path.dirname(LEVEL_CARD_CUSTOMIZATION_PATH), { recursive: true });
  fs.writeFileSync(LEVEL_CARD_CUSTOMIZATION_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getLevelCardCustomization(userId) {
  const state = loadCardCustomizations();
  const user = state.users?.[userId];
  return user && typeof user === 'object' ? { ...user } : {};
}

function updateLevelCardCustomization(userId, changes = {}) {
  const state = loadCardCustomizations();
  const existing = state.users[userId] && typeof state.users[userId] === 'object' ? state.users[userId] : {};
  state.users[userId] = { ...existing, ...changes, updatedAt: Date.now() };
  saveCardCustomizations(state);
  return { ...state.users[userId] };
}

function getUserCardBackgroundPath(userId) {
  return path.join(USER_CARD_BACKGROUND_DIR, String(userId), 'card.png');
}

function findUserCardBackground(userId) {
  const candidate = getUserCardBackgroundPath(userId);
  return fs.existsSync(candidate) ? candidate : null;
}

function normalizeColorValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) return raw;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`;
  const rgb = raw.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (!rgb) return null;
  const channels = rgb.slice(1).map((part) => Math.max(0, Math.min(255, Number(part) || 0)));
  return `rgb(${channels.join(', ')})`;
}

function parseGradientStop(input, fallbackOffset) {
  const raw = String(input || '').trim();
  const splitIndex = raw.lastIndexOf('-');
  let colorRaw = raw;
  let offset = fallbackOffset;
  if (splitIndex > -1) {
    const possibleOffset = raw.slice(splitIndex + 1).trim();
    if (/^\d{1,3}(\.\d+)?%?$/.test(possibleOffset)) {
      colorRaw = raw.slice(0, splitIndex).trim();
      const numeric = Number(possibleOffset.replace('%', ''));
      offset = possibleOffset.endsWith('%') ? numeric / 100 : numeric;
    }
  }
  const color = normalizeColorValue(colorRaw);
  if (!color) return null;
  return { color, offset: Math.max(0, Math.min(1, Number.isFinite(offset) ? offset : fallbackOffset)) };
}

function createFillStyle(ctx, value, x1, y1, x2, y2, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const parts = raw.split(';').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return normalizeColorValue(raw) || fallback;

  const stops = parts.map((part, index) => parseGradientStop(part, parts.length === 1 ? 0 : index / (parts.length - 1))).filter(Boolean);
  if (stops.length === 0) return fallback;
  if (stops.length === 1) return stops[0].color;

  const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  stops.sort((a, b) => a.offset - b.offset).forEach((stop) => gradient.addColorStop(stop.offset, stop.color));
  return gradient;
}

function drawOutlinedText(ctx, text, x, y, fillStyle, outlineStyle = 'rgba(0, 0, 0, 0.95)', outlineWidth = 0.5) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = outlineStyle;
  ctx.lineWidth = outlineWidth;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillStyle;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function floorOneDecimal(value) {
  return Math.floor(Math.max(0, Number(value) || 0) * 10) / 10;
}

function formatOneDecimal(value) {
  return floorOneDecimal(value).toFixed(1);
}

function xpRequirement(level) {
  if (level <= 1) {
    return 100;
  }
  const n = level - 1;
  return Math.round(100 + (20 * n) + (5 * (n ** 1.6)));
}

function getProgress(totalXp) {
  let level = 1;
  let remaining = Math.max(0, Number(totalXp) || 0);
  let req = xpRequirement(level);

  while (remaining >= req) {
    remaining -= req;
    level += 1;
    req = xpRequirement(level);
  }

  return {
    level,
    currentXp: floorOneDecimal(remaining),
    requiredXp: floorOneDecimal(req),
    totalXp: floorOneDecimal(totalXp),
  };
}

function getSortedLeaderboard(guildId) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  return Object.entries(guild.users)
    .map(([userId, user]) => ({ userId, ...ensureUserState(guild, userId), totalXp: floorOneDecimal(user.totalXp) }))
    .sort((a, b) => b.totalXp - a.totalXp);
}

function clearExpiredPunishment(user) {
  if (!user.activePunishment?.tier || !user.activePunishment?.endsAt) {
    return;
  }

  if (Date.now() >= user.activePunishment.endsAt) {
    user.activePunishment = null;
  }
}

function getCurrentPunishment(user) {
  clearExpiredPunishment(user);
  return user.activePunishment;
}

function getXpGainForUser(rawXp, user) {
  if (user.expLocked) {
    return 0;
  }

  const punishment = getCurrentPunishment(user);
  return getXpGainAfterPunishment(rawXp, punishment);
}

function getXpGainAfterPunishment(rawXp, punishment) {
  if (!punishment?.tier) {
    return rawXp;
  }

  if (punishment.tier >= 1 && punishment.tier <= 3) {
    return 0;
  }

  return rawXp;
}

function awardMessageXp(guildId, userId, options = {}) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  const before = getProgress(user.totalXp);
  const hasFixedXp = Number.isFinite(options.fixedXp);
  const rawXp = hasFixedXp ? floorOneDecimal(options.fixedXp) : getMessageXpRoll(guildId, options);
  const xp = floorOneDecimal(getXpGainForUser(rawXp, user));
  user.totalXp = floorOneDecimal(user.totalXp + xp);
  user.messages += 1;
  const after = getProgress(user.totalXp);
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);
  logXpEarn({
    userId,
    guildId,
    amount: xp,
    rawXp,
    source: options.source || 'message',
    channelId: options.channelId,
    messageId: options.messageId,
    totalXp: user.totalXp,
    oldLevel: before.level,
    newLevel: after.level,
  });
  return {
    xp,
    rawXp,
    leveledUp: after.level > before.level,
    oldLevel: before.level,
    newLevel: after.level,
    totalXp: user.totalXp,
  };
}
function setUserLevel(guildId, userId, targetLevel, options = {}) {
  const safeLevel = Math.max(1, Math.floor(Number(targetLevel) || 1));
  let totalXp = 0;
  for (let level = 1; level < safeLevel; level += 1) {
    totalXp += xpRequirement(level);
  }

  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  const before = getProgress(user.totalXp);
  const beforeTotalXp = floorOneDecimal(user.totalXp);
  user.totalXp = floorOneDecimal(totalXp);
  const after = getProgress(user.totalXp);
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);
  logXpEarn({
    userId,
    guildId,
    amount: user.totalXp - beforeTotalXp,
    source: options.source || 'level edit',
    channelId: options.channelId,
    messageId: options.messageId,
    command: options.command,
    totalXp: user.totalXp,
    oldLevel: before.level,
    newLevel: after.level,
  });

  return { level: safeLevel, totalXp: user.totalXp };
}

function setUserXp(guildId, userId, targetXp, options = {}) {
  const safeXp = floorOneDecimal(Number(targetXp) || 0);
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  const before = getProgress(user.totalXp);
  const beforeTotalXp = floorOneDecimal(user.totalXp);
  user.totalXp = safeXp;
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);

  const progress = getProgress(user.totalXp);
  logXpEarn({
    userId,
    guildId,
    amount: user.totalXp - beforeTotalXp,
    source: options.source || 'xp edit',
    channelId: options.channelId,
    messageId: options.messageId,
    command: options.command,
    totalXp: user.totalXp,
    oldLevel: before.level,
    newLevel: progress.level,
  });
  return {
    totalXp: user.totalXp,
    level: progress.level,
  };
}

function addUserXp(guildId, userId, amount, options = {}) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  const before = getProgress(user.totalXp);
  const delta = floorOneDecimal(Number(amount) || 0);
  const addedXp = user.expLocked ? 0 : Math.max(0, delta);
  user.totalXp = floorOneDecimal(user.totalXp + addedXp);
  const after = getProgress(user.totalXp);
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);
  logXpEarn({
    userId,
    guildId,
    amount: addedXp,
    source: options.source || 'xp award',
    channelId: options.channelId,
    messageId: options.messageId,
    command: options.command,
    totalXp: user.totalXp,
    oldLevel: before.level,
    newLevel: after.level,
  });

  return {
    addedXp,
    oldLevel: before.level,
    newLevel: after.level,
    totalXp: user.totalXp,
  };
}

function getUserProgress(guildId, userId) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  clearExpiredPunishment(user);
  return {
    ...getProgress(user.totalXp),
    punishTier: user.punishTier,
    activePunishment: user.activePunishment,
    expLocked: user.expLocked,
    expLockReason: user.expLockReason,
  };
}

function getPunishmentSummary(guildId, userId) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  clearExpiredPunishment(user);

  return {
    tier: user.activePunishment?.tier || 0,
    endsAt: user.activePunishment?.endsAt || null,
    userId,
    expLocked: user.expLocked,
    expLockReason: user.expLockReason,
  };
}

function setUserExpLock(guildId, userId, locked, reason = null) {
  const state = loadState();
  const shouldLock = locked === true;
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  const existingGuild = state.guilds?.[guildId];
  const existingUser = existingGuild?.users?.[userId];

  if (!shouldLock && !existingUser) {
    return {
      userId,
      wasLocked: false,
      expLocked: false,
      expLockReason: null,
      changed: false,
    };
  }

  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  const wasLocked = user.expLocked === true;

  if (wasLocked === shouldLock) {
    if (shouldLock && user.expLockReason !== cleanReason) {
      user.expLockReason = cleanReason;
      user.updatedAt = Date.now();
      guild.updatedAt = Date.now();
      saveState(state);
      return {
        userId,
        wasLocked,
        expLocked: user.expLocked,
        expLockReason: user.expLockReason,
        changed: true,
      };
    }

    return {
      userId,
      wasLocked,
      expLocked: user.expLocked,
      expLockReason: user.expLockReason,
      changed: false,
    };
  }

  user.expLocked = shouldLock;
  user.expLockReason = shouldLock ? cleanReason : null;
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);

  return {
    userId,
    wasLocked,
    expLocked: user.expLocked,
    expLockReason: user.expLockReason,
    changed: true,
  };
}

function applyLevelPunishment(guildId, userId) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);

  clearExpiredPunishment(user);

  const currentTier = Math.max(0, Math.floor(user.punishTier || 0));
  const nextTier = currentTier >= 5 ? 1 : currentTier + 1;
  const now = Date.now();
  let endsAt = null;

  const punishmentDurationsMs = getPunishmentDurationsMs(guildId);
  if (punishmentDurationsMs[nextTier]) {
    endsAt = now + punishmentDurationsMs[nextTier];
    user.activePunishment = { tier: nextTier, endsAt };
  } else {
    user.activePunishment = null;
  }

  if (nextTier === 4) {
    user.totalXp = floorOneDecimal(user.totalXp * 0.5);
  }

  if (nextTier === 5) {
    user.totalXp = 0;
    user.messages = 0;
    user.reactions = 0;
  }

  user.punishTier = nextTier === 5 ? 0 : nextTier;
  user.updatedAt = now;
  guild.updatedAt = now;
  saveState(state);

  return {
    newTier: nextTier,
    nextStoredTier: user.punishTier,
    endsAt,
    userId,
  };
}

function findLevelCardBackground() {
  const guessed = [
    path.join(process.cwd(), LEVEL_CARD_BG_FILENAME),
    path.join(__dirname, '..', LEVEL_CARD_BG_FILENAME),
  ];

  for (const candidate of guessed) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function ensureCacheDirs() {
  fs.mkdirSync(CARD_CACHE_DIR, { recursive: true });
  fs.mkdirSync(LEADERBOARD_CACHE_DIR, { recursive: true });
}

async function drawAvatar(ctx, avatarUrl, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  try {
    const avatar = await loadImage(avatarUrl);
    ctx.drawImage(avatar, x, y, size, size);
  } catch {
    ctx.fillStyle = '#2f3136';
    ctx.fillRect(x, y, size, size);
  }

  ctx.restore();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function getLevelCardRankColors(rank) {
  if (rank === 1) {
    return { fill: '#FFD700', text: '#FFD700' };
  }
  if (rank === 2) {
    return { fill: '#00FFFF', text: '#00FFFF' };
  }
  if (rank === 3) {
    return { fill: '#C4A484', text: '#C4A484' };
  }
  return { fill: null, text: '#f2f3f5' };
}

function getLeaderboardRankColors(rank) {
  if (rank === 1) {
    return { fill: '#FFD700', text: '#000000' };
  }
  if (rank === 2) {
    return { fill: '#00FFFF', text: '#000000' };
  }
  if (rank === 3) {
    return { fill: '#C4A484', text: '#000000' };
  }
  return { fill: null, text: '#f2f3f5' };
}

async function buildLevelCard({ guildId, userId, username, avatarUrl, rank, stats }) {
  ensureCacheDirs();
  const width = 740;
  const height = 278;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const customization = getLevelCardCustomization(userId);

  const bgPath = findUserCardBackground(userId) || findLevelCardBackground();
  if (bgPath) {
    try {
      const background = await loadImage(bgPath);
      ctx.drawImage(background, 0, 0, width, height);
    } catch {
      ctx.fillStyle = '#1e1f22';
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#5865F2');
    gradient.addColorStop(1, '#1f2333');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  roundedRectPath(ctx, 20, 20, width - 40, height - 40, 20);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
  ctx.fill();
  ctx.strokeStyle = createFillStyle(ctx, customization.lineFillColor, 20, 20, width - 20, height - 20, '#5865F2');
  ctx.lineWidth = 3;
  ctx.stroke();

  await drawAvatar(ctx, avatarUrl, 38, 72, 135);

  const usernameX = 190;
  const usernameY = 98;
  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = createFillStyle(ctx, customization.usernameFillColor, usernameX, usernameY - 36, 650, usernameY, '#f2f3f5');
  ctx.fillText(username.slice(0, 28), usernameX, usernameY);

  const rankColors = getLevelCardRankColors(rank);
  ctx.font = 'bold 24px sans-serif';
  drawOutlinedText(ctx, `Rank #${rank}`, usernameX, 136, rankColors.text, '#000000', 0.5);
  ctx.font = '24px sans-serif';
  drawOutlinedText(ctx, `Level ${stats.level}`, usernameX, 174, '#f2f3f5', '#000000', 0.5);

  const progressX = 190;
  const progressY = 203;
  const progressW = 510;
  const progressH = 32;
  const percent = Math.min(1, stats.currentXp / Math.max(1, stats.requiredXp));

  roundedRectPath(ctx, progressX, progressY, progressW, progressH, progressH / 2);
  ctx.fillStyle = '#313338';
  ctx.fill();

  roundedRectPath(ctx, progressX, progressY, progressW * percent, progressH, progressH / 2);
  let progressFill = createFillStyle(ctx, customization.progressBarFillColor, progressX, progressY, progressX + progressW, progressY, null);
  if (!progressFill) {
    progressFill = ctx.createLinearGradient(progressX, progressY, progressX + progressW, progressY);
    progressFill.addColorStop(0, '#5865f2');
    progressFill.addColorStop(1, '#7c8bff');
  }
  ctx.fillStyle = progressFill;
  ctx.fill();

  ctx.fillStyle = createFillStyle(ctx, customization.numberFillColor, progressX, progressY, progressX + 230, progressY, '#dbdee1');
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`${formatOneDecimal(stats.currentXp)} / ${formatOneDecimal(stats.requiredXp)}`, progressX + 12, progressY + 23);

  const filename = `${guildId}-${userId}-level.png`;
  const filePath = path.join(CARD_CACHE_DIR, filename);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  cleanupGeneratedFiles(filePath);
  return new AttachmentBuilder(filePath, { name: 'level-card.png' });
}

async function buildLeaderboardImage({ guildName, rows, type, page, maxPage }) {
  ensureCacheDirs();
  const width = 1100;
  const height = 760;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f2f3f5';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(`${guildName} • ${type}`, 30, 52);
  ctx.font = '24px sans-serif';
  ctx.fillText(`Page ${page} / ${maxPage}`, 900, 52);

  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(20, 80, width - 40, 52);
  ctx.fillStyle = '#dbdee1';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Username', 130, 114);
  ctx.fillText(type === 'xp' ? 'XP' : type === 'messages' ? 'Message' : 'Reaction', 630, 114);
  if (type === 'xp') {
    ctx.fillText('Level', 810, 114);
  }
  ctx.fillText('Rank', 950, 114);

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const y = 144 + (i * 58);
    const rankColors = getLeaderboardRankColors(row.rank);
    ctx.fillStyle = rankColors.fill || (i % 2 === 0 ? '#232428' : '#1e1f22');
    ctx.fillRect(20, y, width - 40, 52);

    await drawAvatar(ctx, row.avatarUrl, 34, y + 6, 40);
    ctx.fillStyle = rankColors.text;
    ctx.font = row.rank <= 3 ? 'bold 20px sans-serif' : '20px sans-serif';
    ctx.fillText(row.username.slice(0, 28), 90, y + 34);

    const value = type === 'xp' ? row.totalXp : type === 'messages' ? row.messages : row.reactions;
    ctx.fillText(formatCompactNumber(value), 645, y + 34);
    if (type === 'xp') {
      const level = getProgress(row.totalXp).level;
      ctx.fillText(`${level}`, 830, y + 34);
    }
    ctx.fillText(`#${row.rank}`, 960, y + 34);
  }

  const filePath = path.join(LEADERBOARD_CACHE_DIR, `leaderboard-${type}-${Date.now()}.png`);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  cleanupGeneratedFiles(filePath);
  return new AttachmentBuilder(filePath, { name: 'leaderboard.png' });
}

module.exports = {
  xpRequirement,
  getProgress,
  getSortedLeaderboard,
  awardMessageXp,
  setUserLevel,
  setUserXp,
  addUserXp,
  getUserProgress,
  getPunishmentSummary,
  setUserExpLock,
  applyLevelPunishment,
  buildLevelCard,
  buildLeaderboardImage,
  getLevelCardCustomization,
  updateLevelCardCustomization,
  getUserCardBackgroundPath,
};
