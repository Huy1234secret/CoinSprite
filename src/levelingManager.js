const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const { loadState, saveState, ensureGuildState, ensureUserState } = require('./levelingStore');

const CARD_CACHE_DIR = path.join(__dirname, '..', 'data', 'level-cards');
const LEADERBOARD_CACHE_DIR = path.join(__dirname, '..', 'data', 'leaderboards');
const LEVEL_CARD_BG_FILENAME = 'Level card background.png';

function xpRequirement(level) {
  if (level <= 1) {
    return 100;
  }
  const n = level - 1;
  return Math.round(100 + (20 * n) + (5 * n * n));
}

function getProgress(totalXp) {
  let level = 1;
  let remaining = totalXp;
  let req = xpRequirement(level);

  while (remaining >= req) {
    remaining -= req;
    level += 1;
    req = xpRequirement(level);
  }

  return {
    level,
    currentXp: remaining,
    requiredXp: req,
    totalXp,
  };
}

function getSortedLeaderboard(guildId) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  return Object.entries(guild.users)
    .map(([userId, user]) => ({ userId, ...ensureUserState(guild, userId) }))
    .sort((a, b) => b.totalXp - a.totalXp);
}

function awardMessageXp(guildId, userId) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  const before = getProgress(user.totalXp);
  const xp = Math.floor(Math.random() * 10) + 1;
  user.totalXp += xp;
  user.messages += 1;
  const after = getProgress(user.totalXp);
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);
  return {
    xp,
    leveledUp: after.level > before.level,
    oldLevel: before.level,
    newLevel: after.level,
    totalXp: user.totalXp,
  };
}

function awardReactionXp(guildId, userId) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  const before = getProgress(user.totalXp);
  const xp = Math.floor(Math.random() * 2) + 1;
  user.totalXp += xp;
  user.reactions += 1;
  const after = getProgress(user.totalXp);
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);
  return {
    xp,
    leveledUp: after.level > before.level,
    oldLevel: before.level,
    newLevel: after.level,
    totalXp: user.totalXp,
  };
}

function setUserLevel(guildId, userId, targetLevel) {
  const safeLevel = Math.max(1, Math.floor(Number(targetLevel) || 1));
  let totalXp = 0;
  for (let level = 1; level < safeLevel; level += 1) {
    totalXp += xpRequirement(level);
  }

  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  user.totalXp = totalXp;
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);

  return { level: safeLevel, totalXp };
}

function addUserXp(guildId, userId, amount) {
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  const before = getProgress(user.totalXp);
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  user.totalXp += delta;
  const after = getProgress(user.totalXp);
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);

  return {
    addedXp: delta,
    oldLevel: before.level,
    newLevel: after.level,
    totalXp: user.totalXp,
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

async function buildLevelCard({ guildId, userId, username, avatarUrl, rank, stats }) {
  ensureCacheDirs();
  const width = 1000;
  const height = 320;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bgPath = findLevelCardBackground();
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

  roundedRectPath(ctx, 28, 28, width - 56, height - 56, 22);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
  ctx.fill();
  ctx.strokeStyle = '#5865F2';
  ctx.lineWidth = 3;
  ctx.stroke();

  await drawAvatar(ctx, avatarUrl, 48, 80, 160);

  ctx.fillStyle = '#f2f3f5';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(username.slice(0, 28), 240, 120);

  ctx.font = '28px sans-serif';
  ctx.fillText(`Rank #${rank}`, 240, 165);
  ctx.fillText(`Level ${stats.level}`, 240, 205);

  const progressX = 240;
  const progressY = 235;
  const progressW = 700;
  const progressH = 36;
  const percent = Math.min(1, stats.currentXp / Math.max(1, stats.requiredXp));

  roundedRectPath(ctx, progressX, progressY, progressW, progressH, progressH / 2);
  ctx.fillStyle = '#313338';
  ctx.fill();

  const bar = ctx.createLinearGradient(progressX, progressY, progressX + progressW, progressY);
  bar.addColorStop(0, '#5865f2');
  bar.addColorStop(1, '#7c8bff');
  roundedRectPath(ctx, progressX, progressY, progressW * percent, progressH, progressH / 2);
  ctx.fillStyle = bar;
  ctx.fill();

  ctx.fillStyle = '#dbdee1';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`${stats.currentXp} / ${stats.requiredXp}`, progressX + 12, progressY + 26);

  const filename = `${guildId}-${userId}-level.png`;
  const filePath = path.join(CARD_CACHE_DIR, filename);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
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
  ctx.fillText(type === 'xp' ? 'XP' : type === 'messages' ? 'Message' : 'Reaction', 700, 114);
  ctx.fillText('Rank', 950, 114);

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const y = 144 + (i * 58);
    ctx.fillStyle = i % 2 === 0 ? '#232428' : '#1e1f22';
    ctx.fillRect(20, y, width - 40, 52);

    await drawAvatar(ctx, row.avatarUrl, 34, y + 6, 40);
    ctx.fillStyle = '#f2f3f5';
    ctx.font = '20px sans-serif';
    ctx.fillText(row.username.slice(0, 28), 90, y + 34);

    const value = type === 'xp' ? row.totalXp : type === 'messages' ? row.messages : row.reactions;
    ctx.fillText(String(value), 715, y + 34);
    ctx.fillText(`#${row.rank}`, 960, y + 34);
  }

  const filePath = path.join(LEADERBOARD_CACHE_DIR, `leaderboard-${type}-${Date.now()}.png`);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  return new AttachmentBuilder(filePath, { name: 'leaderboard.png' });
}

module.exports = {
  xpRequirement,
  getProgress,
  getSortedLeaderboard,
  awardMessageXp,
  awardReactionXp,
  setUserLevel,
  addUserXp,
  buildLevelCard,
  buildLeaderboardImage,
};
