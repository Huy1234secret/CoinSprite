const fs = require('fs');
const { cleanupGeneratedFiles } = require('./fileCleanup');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');

const LEADERBOARD_CACHE_DIR = path.join(__dirname, '..', 'data', 'leaderboards');

function ensureCacheDir() {
  fs.mkdirSync(LEADERBOARD_CACHE_DIR, { recursive: true });
}

function getRankColors(rank) {
  if (rank === 1) return { fill: '#D4AF37', text: '#000000' };
  if (rank === 2) return { fill: '#C0C0C0', text: '#000000' };
  if (rank === 3) return { fill: '#CD7F32', text: '#000000' };
  return { fill: null, text: '#f2f3f5' };
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

async function buildGamblingLeaderboardImage({ guildName, title, metricLabel, rows }) {
  ensureCacheDir();
  const width = 1100;
  const height = 760;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f2f3f5';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(`${guildName} • Gambling`, 30, 52);
  ctx.font = '24px sans-serif';
  ctx.fillText(title.slice(0, 42), 30, 86);

  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(20, 110, width - 40, 52);
  ctx.fillStyle = '#dbdee1';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Username', 130, 144);
  ctx.fillText(metricLabel, 700, 144);
  ctx.fillText('Rank', 950, 144);

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const y = 174 + (i * 58);
    const rankColors = getRankColors(row.rank);
    ctx.fillStyle = rankColors.fill || (i % 2 === 0 ? '#232428' : '#1e1f22');
    ctx.fillRect(20, y, width - 40, 52);

    await drawAvatar(ctx, row.avatarUrl, 34, y + 6, 40);
    ctx.fillStyle = rankColors.text;
    ctx.font = row.rank <= 3 ? 'bold 20px sans-serif' : '20px sans-serif';
    ctx.fillText(row.username.slice(0, 28), 90, y + 34);
    ctx.fillText(String(row.displayValue).slice(0, 22), 715, y + 34);
    ctx.fillText(`#${row.rank}`, 960, y + 34);
  }

  const filePath = path.join(LEADERBOARD_CACHE_DIR, `gambling-leaderboard-${Date.now()}.png`);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  cleanupGeneratedFiles(filePath);
  return new AttachmentBuilder(filePath, { name: 'gambling-leaderboard.png' });
}

module.exports = { buildGamblingLeaderboardImage };
