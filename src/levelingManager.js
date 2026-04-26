const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const { loadState, saveState, ensureGuildState, ensureUserState } = require('./levelingStore');

const CARD_CACHE_DIR = path.join(__dirname, '..', 'data', 'level-cards');
const LEADERBOARD_CACHE_DIR = path.join(__dirname, '..', 'data', 'leaderboards');

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
  const xp = Math.floor(Math.random() * 10) + 1;
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  user.totalXp += xp;
  user.messages += 1;
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);
  return xp;
}

function awardReactionXp(guildId, userId) {
  const xp = Math.floor(Math.random() * 2) + 1;
  const state = loadState();
  const guild = ensureGuildState(state, guildId);
  const user = ensureUserState(guild, userId);
  user.totalXp += xp;
  user.reactions += 1;
  user.updatedAt = Date.now();
  guild.updatedAt = Date.now();
  saveState(state);
  return xp;
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

async function buildLevelCard({ guildId, userId, username, avatarUrl, rank, stats }) {
  ensureCacheDirs();
  const width = 1000;
  const height = 320;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#5865F2');
  gradient.addColorStop(1, '#1f2333');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  await drawAvatar(ctx, avatarUrl, 48, 80, 160);

  ctx.fillStyle = '#ffffff';
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

  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(progressX, progressY, progressW, progressH);

  const bar = ctx.createLinearGradient(progressX, progressY, progressX + progressW, progressY);
  bar.addColorStop(0, '#00d4ff');
  bar.addColorStop(1, '#6a7bff');
  ctx.fillStyle = bar;
  ctx.fillRect(progressX, progressY, progressW * percent, progressH);

  ctx.fillStyle = '#fff';
  ctx.font = '24px sans-serif';
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

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1f2328';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(`${guildName} • ${type}`, 30, 52);
  ctx.font = '24px sans-serif';
  ctx.fillText(`Page ${page} / ${maxPage}`, 900, 52);

  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(20, 80, width - 40, 52);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Username', 130, 114);
  ctx.fillText(type === 'xp' ? 'XP' : type === 'messages' ? 'Message' : 'Reaction', 700, 114);
  ctx.fillText('Rank', 950, 114);

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const y = 144 + (i * 58);
    ctx.fillStyle = i % 2 === 0 ? '#fafafa' : '#f0f2f5';
    ctx.fillRect(20, y, width - 40, 52);

    await drawAvatar(ctx, row.avatarUrl, 34, y + 6, 40);
    ctx.fillStyle = '#111827';
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
  buildLevelCard,
  buildLeaderboardImage,
};
