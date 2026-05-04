const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { WHITE_ACCENT } = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const STAGE_IMAGE_NAME = 'journey-stage.png';
const BANNER_BASENAME = 'JungleBanner';
const IMAGES_DIR = path.join(__dirname, '..', 'Images');

const STAGES = [
  {
    id: 'jungle_entrance',
    name: 'Jungle Entrance',
    chapter: 1,
    stage: 1,
    stars: 0,
    completed: false,
    enemies: [
      { id: 'slime', name: 'Slime', count: 2 },
      { id: 'goblin', name: 'Goblin', count: 1 },
      { id: 'bat', name: 'Bat', count: 1 },
    ],
  },
  {
    id: 'mossy_ruins',
    name: 'Mossy Ruins',
    chapter: 1,
    stage: 2,
    stars: 0,
    completed: false,
    enemies: [
      { id: 'goblin', name: 'Goblin', count: 2 },
      { id: 'wolf', name: 'Wolf', count: 1 },
    ],
  },
  {
    id: 'ancient_canopy',
    name: 'Ancient Canopy',
    chapter: 1,
    stage: 3,
    stars: 0,
    completed: false,
    enemies: [
      { id: 'bat', name: 'Bat', count: 2 },
      { id: 'treant', name: 'Treant', count: 1 },
    ],
  },
];

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function actionRow(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function selectMenu(customId, placeholder, options, disabled = false) { return { type: 3, custom_id: customId, placeholder, disabled, options }; }
function mediaGallery(url) { return { type: 12, items: [{ media: { url } }] }; }
function payload(interaction, stage, imageAttachment) {
  const completed = STAGES.filter((item) => item.completed).length;
  return {
    flags: COMPONENTS_V2_FLAG,
    files: imageAttachment ? [imageAttachment] : [],
    components: [
      {
        type: 17,
        accent_color: WHITE_ACCENT,
        components: [
          text(`## ${interaction.user.username}'s Journey`),
          mediaGallery(`attachment://${STAGE_IMAGE_NAME}`),
          text(`-# You have completed ${completed} / ${STAGES.length} stages so far`),
          separator(),
          actionRow(button(`journey:change:${interaction.user.id}`, 'Change Stages', 2, true)),
          actionRow(selectMenu(`journey:chapter:${interaction.user.id}`, 'More Chapter soon', [{ label: 'More Chapter soon', value: 'soon', description: 'New chapters will be added later.' }], true)),
        ],
      },
    ],
  };
}

function findBannerPath() {
  if (!fs.existsSync(IMAGES_DIR)) return null;
  const files = fs.readdirSync(IMAGES_DIR);
  const exact = files.find((file) => path.parse(file).name.toLowerCase() === BANNER_BASENAME.toLowerCase());
  return exact ? path.join(IMAGES_DIR, exact) : null;
}

function drawStar(ctx, cx, cy, outerRadius, innerRadius) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = (-Math.PI / 2) + (i * Math.PI / 5);
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function normalizeEnemies(enemies) {
  const byId = new Map();
  for (const enemy of enemies || []) {
    const key = enemy.id || enemy.name;
    const current = byId.get(key) || { ...enemy, count: 0 };
    current.count += Math.max(1, Number(enemy.count) || 1);
    byId.set(key, current);
  }
  return [...byId.values()];
}

function stageNumberLabel(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return Math.floor(number);
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function stageSubtitle(stage) {
  return `Chapter ${stageNumberLabel(stage.chapter, 1)} - ${stageNumberLabel(stage.stage, 1)}`;
}

function setTextShadow(ctx, blur = 8) {
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
}

function clearTextShadow(ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function strokedText(ctx, value, x, y, fillStyle, strokeStyle, strokeWidth = 6) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = strokeWidth;
  ctx.strokeText(value, x, y);
  ctx.fillStyle = fillStyle;
  ctx.fillText(value, x, y);
}

function createFallbackBanner() {
  const width = 2048;
  const height = 330;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#163d1d');
  gradient.addColorStop(0.5, '#3f8d42');
  gradient.addColorStop(1, '#0b2a16');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

async function loadBannerCanvas() {
  const bannerPath = findBannerPath();
  if (!bannerPath) return createFallbackBanner();
  const banner = await loadImage(bannerPath);
  const canvas = createCanvas(banner.width, banner.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(banner, 0, 0);
  return canvas;
}

function drawMapInfo(ctx, stage, width, height) {
  const scale = Math.max(0.7, Math.min(width / 2048, height / 330));
  const left = Math.round(width * 0.035);
  const top = Math.round(height * 0.215);

  ctx.textBaseline = 'alphabetic';
  setTextShadow(ctx, 13);
  ctx.font = `800 ${Math.round(50 * scale)}px Arial`;
  strokedText(ctx, 'MAP', left, top, '#f8fff0', 'rgba(0, 0, 0, 0.72)', Math.round(10 * scale));

  ctx.font = `900 ${Math.round(96 * scale)}px Arial`;
  strokedText(ctx, stage.name, left, top + Math.round(98 * scale), '#ffffff', 'rgba(0, 0, 0, 0.82)', Math.round(13 * scale));

  ctx.font = `800 ${Math.round(42 * scale)}px Arial`;
  strokedText(ctx, stageSubtitle(stage), left + Math.round(3 * scale), top + Math.round(160 * scale), '#f4ffe0', 'rgba(0, 0, 0, 0.72)', Math.round(10 * scale));
  clearTextShadow(ctx);

  for (let i = 0; i < 3; i += 1) {
    const starX = left + Math.round((55 + (i * 122)) * scale);
    const starY = top + Math.round(226 * scale);
    drawStar(ctx, starX, starY, Math.round(52 * scale), Math.round(23 * scale));
    ctx.fillStyle = i < Math.max(0, Math.min(3, stage.stars || 0)) ? '#f5c542' : '#000000';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(3, Math.round(6 * scale));
    ctx.stroke();
  }
}

function drawEnemyList(ctx, stage, width, height) {
  const enemies = normalizeEnemies(stage.enemies).slice(0, 5);
  const scale = Math.max(0.7, Math.min(width / 2048, height / 330));
  const right = Math.round(width * 0.955);
  const titleY = Math.round(height * 0.30);
  const circleY = Math.round(height * 0.58);
  const radius = Math.round(78 * scale);
  const gap = Math.round(176 * scale);
  const totalWidth = enemies.length > 0 ? ((enemies.length - 1) * gap) : 0;
  const startX = right - totalWidth - radius;

  ctx.textAlign = 'right';
  setTextShadow(ctx, 12);
  ctx.font = `900 ${Math.round(50 * scale)}px Arial`;
  strokedText(ctx, 'Enemies', right, titleY, '#ffffff', 'rgba(0, 0, 0, 0.82)', Math.round(10 * scale));
  clearTextShadow(ctx);

  ctx.textAlign = 'center';
  enemies.forEach((enemy, index) => {
    const x = startX + (index * gap);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = Math.round(18 * scale);
    ctx.shadowOffsetY = Math.round(7 * scale);
    ctx.beginPath();
    ctx.arc(x, circleY, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18, 18, 18, 0.88)';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, circleY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.lineWidth = Math.max(6, Math.round(7 * scale));
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(54 * scale)}px Arial`;
    ctx.fillText('?', x, circleY + Math.round(18 * scale));

    setTextShadow(ctx, 10);
    ctx.font = `800 ${Math.round(34 * scale)}px Arial`;
    strokedText(ctx, enemy.name, x, circleY + Math.round(118 * scale), '#ffffff', 'rgba(0, 0, 0, 0.9)', Math.round(8 * scale));
    clearTextShadow(ctx);

    if (enemy.count > 1) {
      const badgeX = x + Math.round(56 * scale);
      const badgeY = circleY + Math.round(54 * scale);
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, Math.round(36 * scale), 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(3, Math.round(5 * scale));
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(27 * scale)}px Arial`;
      ctx.fillText(`x${enemy.count}`, badgeX, badgeY + Math.round(9 * scale));
    }
  });

  ctx.textAlign = 'left';
}

async function createJourneyStageImage(stage) {
  const canvas = await loadBannerCanvas();
  const ctx = canvas.getContext('2d');
  drawMapInfo(ctx, stage, canvas.width, canvas.height);
  drawEnemyList(ctx, stage, canvas.width, canvas.height);
  return canvas.encode('png');
}

module.exports = {
  bypassGlobalCooldown: true,
  data: new SlashCommandBuilder()
    .setName('journey')
    .setDescription('Select an adventure stage.'),

  async execute(interaction) {
    await interaction.deferReply();
    const stage = STAGES[0];
    const image = await createJourneyStageImage(stage);
    const attachment = new AttachmentBuilder(image, { name: STAGE_IMAGE_NAME });
    await interaction.editReply(payload(interaction, stage, attachment));
  },

  async handleInteraction(interaction) {
    if (!interaction.customId?.startsWith('journey:')) return false;
    await interaction.reply({ content: 'More stages and chapters are coming soon.', flags: MessageFlags.Ephemeral });
    return true;
  },
};
