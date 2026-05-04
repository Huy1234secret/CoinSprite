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
    chapter: 'Chapter 1',
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
    chapter: 'Chapter 1',
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
    chapter: 'Chapter 1',
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
function mediaGallery(url, description) { return { type: 12, items: [{ media: { url }, description }] }; }
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
          mediaGallery(`attachment://${STAGE_IMAGE_NAME}`, `${stage.name} stage preview`),
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

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
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

async function createJourneyStageImage(stage) {
  const width = 1024;
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
    gradient.addColorStop(1, '#70b54d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, width, height);

  roundedRect(ctx, 34, 38, 390, 244, 28);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#111111';
  ctx.font = '700 28px Arial';
  ctx.fillText('Map', 70, 95);
  ctx.font = '800 38px Arial';
  ctx.fillText(stage.name, 70, 150);
  ctx.font = '600 20px Arial';
  ctx.fillText(stage.chapter || 'Chapter 1', 72, 184);

  for (let i = 0; i < 3; i += 1) {
    drawStar(ctx, 94 + (i * 62), 232, 24, 11);
    ctx.fillStyle = i < Math.max(0, Math.min(3, stage.stars || 0)) ? '#f5c542' : '#000000';
    ctx.fill();
  }

  const enemies = normalizeEnemies(stage.enemies).slice(0, 5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.80)';
  roundedRect(ctx, 598, 38, 392, 244, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.stroke();

  ctx.fillStyle = '#111111';
  ctx.font = '800 27px Arial';
  ctx.fillText('Enemies', 638, 86);

  const startX = 658;
  const startY = 154;
  const gap = 72;
  enemies.forEach((enemy, index) => {
    const x = startX + (index * gap);
    const y = startY;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('?', x, y + 7);

    ctx.fillStyle = '#111111';
    ctx.font = '600 14px Arial';
    ctx.fillText(enemy.name, x, y + 55);

    if (enemy.count > 1) {
      ctx.beginPath();
      ctx.arc(x + 24, y + 24, 15, 0, Math.PI * 2);
      ctx.fillStyle = '#111111';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 13px Arial';
      ctx.fillText(`x${enemy.count}`, x + 24, y + 29);
    }
  });
  ctx.textAlign = 'left';

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
