const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getUserProgress } = require('../src/playerLevelStore');
const { formatNumber } = require('../src/gamblingConfig');

const CARD_NAME = 'player-level-card.png';
const BANNER_BASENAME = 'JungleBanner';
const IMAGES_DIR = path.join(__dirname, '..', 'Images');

function findBannerPath() {
  if (!fs.existsSync(IMAGES_DIR)) return null;
  const exact = fs.readdirSync(IMAGES_DIR).find((file) => path.parse(file).name.toLowerCase() === BANNER_BASENAME.toLowerCase());
  return exact ? path.join(IMAGES_DIR, exact) : null;
}
function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
async function drawAvatar(ctx, url, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  try {
    const avatar = await loadImage(url);
    ctx.drawImage(avatar, x, y, size, size);
  } catch {
    ctx.fillStyle = '#111111';
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}
async function buildPlayerLevelCard(interaction) {
  const width = 1000;
  const height = 320;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const bannerPath = findBannerPath();
  if (bannerPath) {
    const banner = await loadImage(bannerPath);
    ctx.drawImage(banner, 0, 0, width, height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#163d1d');
    gradient.addColorStop(1, '#0b2a16');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  roundedRectPath(ctx, 28, 28, width - 56, height - 56, 26);
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 4;
  ctx.stroke();

  const stats = getUserProgress(interaction.user.id);
  const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });
  await drawAvatar(ctx, avatarUrl, 56, 78, 164);

  ctx.shadowColor = 'rgba(0,0,0,.85)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 46px Arial';
  ctx.fillText(interaction.user.username.slice(0, 28), 250, 118);
  ctx.font = '900 30px Arial';
  ctx.fillText(`Level ${stats.level}`, 250, 164);
  ctx.shadowColor = 'transparent';

  const barX = 250;
  const barY = 210;
  const barW = 680;
  const barH = 42;
  const percent = Math.max(0, Math.min(1, stats.currentXp / Math.max(1, stats.requiredXp)));
  roundedRectPath(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fillStyle = '#050505';
  ctx.fill();
  roundedRectPath(ctx, barX, barY, Math.max(barH, barW * percent), barH, barH / 2);
  ctx.fillStyle = '#57f287';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 25px Arial';
  ctx.fillText(`${formatNumber(stats.currentXp)} / ${formatNumber(stats.requiredXp)} EXP`, barX + 18, barY + 29);

  return new AttachmentBuilder(canvas.encode('png'), { name: CARD_NAME });
}

module.exports = {
  data: new SlashCommandBuilder().setName('level-player').setDescription('Show your adventure player level card.'),
  async execute(interaction) {
    const attachment = await buildPlayerLevelCard(interaction);
    await interaction.reply({ files: [attachment] });
  },
};
