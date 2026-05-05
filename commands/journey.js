const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { WHITE_ACCENT, GREEN_ACCENT, RED_ACCENT, COIN, formatNumber } = require('../src/gamblingConfig');
const { addBalance } = require('../src/gamblingStore');
const { addInventoryItem } = require('../src/playerInventoryStore');
const { addPlayerXp } = require('../src/playerLevelStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const STAGE_IMAGE_NAME = 'journey-stage.png';
const BATTLE_IMAGE_NAME = 'journey-battle.png';
const BANNER_BASENAME = 'JungleBanner';
const IMAGES_DIR = path.join(__dirname, '..', 'Images');
const PROGRESS_PATH = path.join(__dirname, '..', 'data', 'journey-stage-progress.json');
const FIST_EMOJI = { id: '1500805602576826368', name: 'WPFist' };
const SLIME_EMOJI_OBJECT = { id: '1501095601432170506', name: 'ENJungleSlime' };
const SLIME_EMOJI = '<:ENJungleSlime:1501095601432170506>';
const SLIME_URL = 'https://cdn.discordapp.com/emojis/1501095601432170506.png?size=256&quality=lossless';
const DEFENSE_EMOJI = '<:SBDefense:1501156914665488486>';
const DEFENSE_URL = 'https://cdn.discordapp.com/emojis/1501156914665488486.png?size=128&quality=lossless';
const GOO_EMOJI = '<:ITJungleGoo:1501156916737609798>';
const activeBattles = new Map();

const STAGES = [
  {
    id: 'jungle_entrance',
    name: 'Jungle Entrance',
    chapter: 1,
    stage: 1,
    reward: { coins: 100, exp: 25 },
    enemies: [{ id: 'jungle_slime', name: 'Jungle Slime', emoji: SLIME_EMOJI, count: 2, hp: 10, maxPower: 10, rarity: 'Common', imageUrl: SLIME_URL }],
  },
  { id: 'mossy_ruins', name: 'Mossy Ruins', chapter: 1, stage: 2, reward: { coins: 100, exp: 25 }, enemies: [{ id: 'jungle_slime', name: 'Jungle Slime', emoji: SLIME_EMOJI, count: 2, hp: 10, maxPower: 10, rarity: 'Common', imageUrl: SLIME_URL }] },
  { id: 'ancient_canopy', name: 'Ancient Canopy', chapter: 1, stage: 3, reward: { coins: 100, exp: 25 }, enemies: [{ id: 'jungle_slime', name: 'Jungle Slime', emoji: SLIME_EMOJI, count: 2, hp: 10, maxPower: 10, rarity: 'Common', imageUrl: SLIME_URL }] },
];

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function selectMenu(customId, placeholder, options, disabled = false) { return { type: 3, custom_id: customId, placeholder, disabled, options }; }
function mediaGallery(url) { return { type: 12, items: [{ media: { url } }] }; }
function rand(min, max) { return Math.floor(Math.random() * ((max - min) + 1)) + min; }
function chance(probability) { return Math.random() < Number(probability || 0); }
function stageSubtitle(stage) { return `Chapter ${stage.chapter} - ${stage.stage}`; }
function reducedReward(reward, completed) { return completed ? { coins: Math.floor(reward.coins * 0.1), exp: Math.floor(reward.exp * 0.1) } : { ...reward }; }
function formatStageReward(stage) { return `Stage reward: ${formatNumber(stage.reward?.coins || 0)} ${COIN}, ${formatNumber(stage.reward?.exp || 0)} exp.`; }
function formatDropLine(drop) { return `-# * ×${formatNumber(drop.amount)} ${drop.name} ${drop.emoji}`; }

function ensureProgressFile() {
  const dir = path.dirname(PROGRESS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(PROGRESS_PATH)) fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ users: {} }, null, 2));
}
function loadProgress() {
  ensureProgressFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
    return parsed;
  } catch { return { users: {} }; }
}
function saveProgress(state) { ensureProgressFile(); fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 2)); }
function getStageProgress(userId, stageId) {
  const state = loadProgress();
  const user = state.users[userId] || {};
  return user[stageId] || { completed: false, stars: 0, bestTimeMs: 0, bestHp: 0 };
}
function setStageComplete(userId, stageId, stars, elapsedMs, hp) {
  const state = loadProgress();
  if (!state.users[userId]) state.users[userId] = {};
  const prev = state.users[userId][stageId] || { completed: false, stars: 0, bestTimeMs: 0, bestHp: 0 };
  state.users[userId][stageId] = {
    completed: true,
    stars: Math.max(prev.stars || 0, stars),
    bestTimeMs: prev.bestTimeMs ? Math.min(prev.bestTimeMs, elapsedMs) : elapsedMs,
    bestHp: Math.max(prev.bestHp || 0, hp),
    updatedAt: Date.now(),
  };
  saveProgress(state);
  return state.users[userId][stageId];
}
function allCompletedCount(userId) { return STAGES.filter((stage) => getStageProgress(userId, stage.id).completed).length; }
function calcStars(session) {
  const elapsed = Date.now() - session.startedAt;
  if (elapsed < 60000 && session.player.hp > session.player.maxHp / 2) return 3;
  if (elapsed < 60000) return 2;
  return 1;
}

function setTextShadow(ctx, blur = 8) {
  ctx.shadowColor = 'rgba(0,0,0,.85)';
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
function fitFont(ctx, value, maxWidth, startSize, minSize = 16, weight = 900) {
  let size = startSize;
  while (size >= minSize) {
    ctx.font = `${weight} ${size}px Arial`;
    if (ctx.measureText(value).width <= maxWidth) return size;
    size -= 2;
  }
  return minSize;
}
function strokeFitText(ctx, value, x, y, maxWidth, startSize, fill = '#fff', stroke = 'rgba(0,0,0,.82)', weight = 900, align = 'left') {
  ctx.textAlign = align;
  const size = fitFont(ctx, value, maxWidth, startSize, 16, weight);
  ctx.font = `${weight} ${size}px Arial`;
  strokedText(ctx, value, x, y, fill, stroke, Math.max(4, Math.round(size * 0.18)));
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
function drawStar(ctx, cx, cy, outerRadius, innerRadius, filled) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = (-Math.PI / 2) + (i * Math.PI / 5);
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = filled ? '#f5c542' : '#000';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = Math.max(3, Math.round(outerRadius * 0.12));
  ctx.stroke();
}
async function loadRemoteImage(url) { if (!url) return null; try { return await loadImage(url); } catch { return null; } }
function findBannerPath() {
  if (!fs.existsSync(IMAGES_DIR)) return null;
  const exact = fs.readdirSync(IMAGES_DIR).find((file) => path.parse(file).name.toLowerCase() === BANNER_BASENAME.toLowerCase());
  return exact ? path.join(IMAGES_DIR, exact) : null;
}
function createFallbackBanner() {
  const canvas = createCanvas(2048, 330);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#163d1d');
  gradient.addColorStop(0.5, '#3f8d42');
  gradient.addColorStop(1, '#0b2a16');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}
async function loadBannerCanvas() {
  const bannerPath = findBannerPath();
  if (!bannerPath) return createFallbackBanner();
  const banner = await loadImage(bannerPath);
  const canvas = createCanvas(banner.width, banner.height);
  canvas.getContext('2d').drawImage(banner, 0, 0);
  return canvas;
}
function drawSimpleProfileCircle(ctx, x, y, radius, image, fallback = '?', border = 'rgba(255,255,255,.9)') {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.75)';
  ctx.shadowBlur = Math.round(radius * 0.2);
  ctx.shadowOffsetY = Math.round(radius * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#050505';
  ctx.fill();
  ctx.restore();
  if (image) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius - Math.max(5, Math.round(radius * 0.06)), 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${Math.round(radius * 0.7)}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(fallback, x, y + Math.round(radius * 0.25));
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(5, Math.round(radius * 0.08));
  ctx.stroke();
}
function drawVerticalRing(ctx, x, y, radius, value, max, color, width) {
  const percent = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const lineRadius = radius - (width / 2);
  const segments = 180;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  for (let i = 0; i < segments; i += 1) {
    const a1 = -Math.PI / 2 + (Math.PI * 2 * i / segments);
    const a2 = -Math.PI / 2 + (Math.PI * 2 * (i + 1.05) / segments);
    const mid = (a1 + a2) / 2;
    const midY = y + Math.sin(mid) * lineRadius;
    const cutoffY = (y - lineRadius) + (lineRadius * 2 * (1 - percent));
    ctx.beginPath();
    ctx.arc(x, y, lineRadius, a1, a2);
    ctx.strokeStyle = midY >= cutoffY ? color : '#050505';
    ctx.stroke();
  }
  ctx.restore();
}
function drawEnemyProfileCircle(ctx, { x, y, radius, image, defenseImage, hp, maxHp, power = 0, maxPower = 1, defense = 0 }) {
  const hpWidth = Math.max(8, Math.round(radius * 0.075));
  const powWidth = Math.max(5, Math.round(radius * 0.05));
  const whiteWidth = Math.max(2, Math.round(radius * 0.024));
  const powerRadius = radius - hpWidth - Math.max(3, Math.round(radius * 0.025));
  const whiteRadius = powerRadius - powWidth - Math.max(2, Math.round(radius * 0.02));
  const contentRadius = whiteRadius - whiteWidth - 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.75)';
  ctx.shadowBlur = Math.round(radius * 0.2);
  ctx.shadowOffsetY = Math.round(radius * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, contentRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#050505';
  ctx.fill();
  ctx.restore();
  if (image) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, contentRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, x - contentRadius, y - contentRadius, contentRadius * 2, contentRadius * 2);
    ctx.restore();
  }
  drawVerticalRing(ctx, x, y, radius, hp, maxHp, '#ff4040', hpWidth);
  if (power > 0) drawVerticalRing(ctx, x, y, powerRadius, power, maxPower, '#00ffff', powWidth);
  ctx.beginPath();
  ctx.arc(x, y, whiteRadius, 0, Math.PI * 2);
  ctx.lineWidth = whiteWidth;
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.stroke();
  if (defense > 0) {
    const badgeR = Math.round(radius * 0.22);
    const bx = x + Math.round(radius * 0.6);
    const by = y + Math.round(radius * 0.6);
    ctx.beginPath();
    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = '#050505';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, Math.round(radius * 0.025));
    ctx.stroke();
    if (defenseImage) ctx.drawImage(defenseImage, bx - badgeR + 3, by - badgeR + 3, (badgeR - 3) * 2, (badgeR - 3) * 2);
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${Math.round(badgeR * 0.7)}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(String(defense), bx + Math.round(badgeR * 0.35), by + Math.round(badgeR * 0.43));
  }
}
function drawStatLine(ctx, x, y, width, height, value, max, color, label) {
  const percent = Math.max(0, Math.min(1, value / Math.max(1, max)));
  roundedRectPath(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = '#050505';
  ctx.fill();
  if (percent > 0) {
    roundedRectPath(ctx, x, y, Math.max(height, width * percent), height, height / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.92)';
  ctx.lineWidth = Math.max(2, Math.round(height * 0.12));
  ctx.stroke();
  if (label) {
    setTextShadow(ctx, 4);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.round(height * 0.72)}px Arial`;
    ctx.fillText(label, x + width / 2, y + Math.round(height * 0.77));
    clearTextShadow(ctx);
  }
}
function drawMapInfo(ctx, stage, progress, width, height) {
  const scale = Math.max(0.7, Math.min(width / 2048, height / 330));
  const left = Math.round(width * 0.035);
  const top = Math.round(height * 0.215);
  ctx.textBaseline = 'alphabetic';
  setTextShadow(ctx, 13);
  ctx.font = `800 ${Math.round(50 * scale)}px Arial`;
  strokedText(ctx, 'MAP', left, top, '#f8fff0', 'rgba(0,0,0,.72)', Math.round(10 * scale));
  ctx.font = `900 ${Math.round(96 * scale)}px Arial`;
  strokedText(ctx, stage.name, left, top + Math.round(98 * scale), '#fff', 'rgba(0,0,0,.82)', Math.round(13 * scale));
  ctx.font = `800 ${Math.round(42 * scale)}px Arial`;
  strokedText(ctx, stageSubtitle(stage), left + Math.round(3 * scale), top + Math.round(160 * scale), '#f4ffe0', 'rgba(0,0,0,.72)', Math.round(10 * scale));
  if (progress.completed) {
    ctx.font = `900 ${Math.round(34 * scale)}px Arial`;
    strokedText(ctx, 'COMPLETED', left + Math.round(250 * scale), top + Math.round(160 * scale), '#57f287', 'rgba(0,0,0,.82)', Math.round(8 * scale));
  }
  clearTextShadow(ctx);
  for (let i = 0; i < 3; i += 1) {
    drawStar(ctx, left + Math.round((55 + (i * 122)) * scale), top + Math.round(226 * scale), Math.round(52 * scale), Math.round(23 * scale), i < (progress.stars || 0));
  }
}
async function drawEnemyList(ctx, stage, width, height) {
  const enemies = stage.enemies.slice(0, 5);
  const image = await loadRemoteImage(SLIME_URL);
  const scale = Math.max(0.7, Math.min(width / 2048, height / 330));
  const right = Math.round(width * 0.955);
  const circleY = Math.round(height * 0.58);
  const radius = Math.round(72 * scale);
  const gap = Math.round(radius * 2.2);
  const startX = right - ((enemies.length - 1) * gap) - radius;
  ctx.textAlign = 'right';
  setTextShadow(ctx, 12);
  ctx.font = `900 ${Math.round(50 * scale)}px Arial`;
  strokedText(ctx, 'Enemies', right, Math.round(height * 0.30), '#fff', 'rgba(0,0,0,.82)', Math.round(10 * scale));
  clearTextShadow(ctx);
  enemies.forEach((enemy, index) => {
    const x = startX + (index * gap);
    drawSimpleProfileCircle(ctx, x, circleY, radius, image);
    setTextShadow(ctx, 10);
    strokeFitText(ctx, enemy.name, x, circleY + Math.round(radius * 1.44), Math.round(radius * 2.4), Math.round(radius * 0.38), '#fff', 'rgba(0,0,0,.9)', 800, 'center');
    clearTextShadow(ctx);
    if (enemy.count > 1) {
      const badgeX = x + Math.round(48 * scale);
      const badgeY = circleY + Math.round(48 * scale);
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, Math.round(28 * scale), 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(3, Math.round(4 * scale));
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(22 * scale)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(`x${enemy.count}`, badgeX, badgeY + Math.round(8 * scale));
    }
  });
}
async function createJourneyStageImage(stage, userId) {
  const canvas = await loadBannerCanvas();
  const ctx = canvas.getContext('2d');
  drawMapInfo(ctx, stage, getStageProgress(userId, stage.id), canvas.width, canvas.height);
  await drawEnemyList(ctx, stage, canvas.width, canvas.height);
  return await canvas.encode('png');
}
function drawNameAndLevel(ctx, name, level, x, y, scale, align = 'left', maxWidth = 460) {
  setTextShadow(ctx, 13);
  strokeFitText(ctx, name, x, y, maxWidth, Math.round(52 * scale), '#fff', 'rgba(0,0,0,.82)', 900, align);
  strokeFitText(ctx, `Level ${level}`, x, y + Math.round(42 * scale), maxWidth, Math.round(30 * scale), '#fff', 'rgba(0,0,0,.82)', 900, align);
  clearTextShadow(ctx);
}
function drawEnemyBattleSlot(ctx, enemy, centerX, centerY, radius, scale, slimeImage, defenseImage, maxTextWidth) {
  centerX = Math.round(centerX);
  centerY = Math.round(centerY);
  drawEnemyProfileCircle(ctx, { x: centerX, y: centerY, radius, image: slimeImage, defenseImage, hp: enemy.hp, maxHp: enemy.maxHp, power: enemy.power, maxPower: enemy.maxPower, defense: enemy.defense });
  const textY = centerY + radius + Math.round(34 * scale);
  drawNameAndLevel(ctx, enemy.name, enemy.level || 1, centerX, textY, Math.max(0.56, scale * 0.68), 'center', Math.round(maxTextWidth));
  if (enemy.status) {
    setTextShadow(ctx, 7);
    strokeFitText(ctx, enemy.status, centerX, textY + Math.round(68 * scale), Math.round(maxTextWidth), Math.round(18 * scale), '#fff', 'rgba(0,0,0,.82)', 900, 'center');
    clearTextShadow(ctx);
  }
}
async function createBattleImage(session) {
  const canvas = await loadBannerCanvas();
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const scale = Math.max(0.7, Math.min(width / 2048, height / 330));
  const avatar = await loadRemoteImage(session.avatarUrl);
  const slimeImage = await loadRemoteImage(SLIME_URL);
  const defenseImage = await loadRemoteImage(DEFENSE_URL);

  const playerRadius = Math.round(118 * scale);
  const playerX = Math.round(width * 0.08);
  const playerY = Math.round(height * 0.54);
  const playerTextX = Math.round(width * 0.185);
  const playerTextY = Math.round(height * 0.23);
  drawSimpleProfileCircle(ctx, playerX, playerY, playerRadius, avatar, '?', 'rgba(255,255,255,.95)');
  drawNameAndLevel(ctx, session.username, session.player.level, playerTextX, playerTextY, scale, 'left', Math.round(width * 0.24));
  drawStatLine(ctx, playerTextX, playerTextY + Math.round(67 * scale), Math.round(505 * scale), Math.round(34 * scale), session.player.hp, session.player.maxHp, '#ff4040', `${session.player.hp}/${session.player.maxHp} HP`);
  drawStatLine(ctx, playerTextX, playerTextY + Math.round(114 * scale), Math.round(505 * scale), Math.round(34 * scale), session.player.power, session.player.maxPower, '#00ffff', `${session.player.power}/${session.player.maxPower} Power`);

  const alive = session.enemies.filter((enemy) => enemy.hp > 0);
  const radius = Math.round(112 * scale);
  if (alive.length === 1) {
    drawEnemyBattleSlot(ctx, alive[0], width * 0.72, height * 0.40, radius, scale, slimeImage, defenseImage, width * 0.17);
  } else if (alive.length === 2) {
    const spacing = Math.round(radius * 2.45);
    const baseX = Math.round(width * 0.72);
    drawEnemyBattleSlot(ctx, alive[0], baseX - spacing / 2, height * 0.40, radius, scale, slimeImage, defenseImage, spacing * 0.95);
    drawEnemyBattleSlot(ctx, alive[1], baseX + spacing / 2, height * 0.40, radius, scale, slimeImage, defenseImage, spacing * 0.95);
  } else {
    const cols = Math.min(3, Math.max(1, alive.length));
    const areaX = Math.round(width * 0.55);
    const areaW = Math.round(width * 0.34);
    const cellW = areaW / cols;
    alive.forEach((enemy, index) => drawEnemyBattleSlot(ctx, enemy, areaX + (index % cols) * cellW + cellW / 2, height * (0.35 + Math.floor(index / cols) * 0.34), Math.min(radius, cellW * 0.36), scale, slimeImage, defenseImage, cellW * 0.94));
  }
  return await canvas.encode('png');
}

function homePayload(interaction, stage, imageAttachment) {
  const progress = getStageProgress(interaction.user.id, stage.id);
  const reward = reducedReward(stage.reward, progress.completed);
  return {
    flags: COMPONENTS_V2_FLAG,
    files: imageAttachment ? [imageAttachment] : [],
    components: [{
      type: 17,
      accent_color: WHITE_ACCENT,
      components: [
        text(`## ${interaction.user.username}'s Journey`),
        mediaGallery(`attachment://${STAGE_IMAGE_NAME}`),
        text(`-# You have completed ${allCompletedCount(interaction.user.id)} / ${STAGES.length} stages so far\n* ${formatStageReward({ reward })}`),
        separator(),
        row(button(`journey:play:${interaction.user.id}:${stage.id}`, 'Play', 3), button(`journey:change:${interaction.user.id}`, 'Change Stages', 2, true)),
        row(selectMenu(`journey:chapter:${interaction.user.id}`, 'More Chapter soon', [{ label: 'More Chapter soon', value: 'soon', description: 'New chapters will be added later.' }], true)),
      ],
    }],
  };
}
function battleSelectRows(session, disabled = false) {
  const canAct = !disabled && session.turn === 'player';
  return [
    row(selectMenu(`journey:attack:${session.userId}:${session.id}`, 'Attack', [{ label: 'Punch', value: 'punch', description: 'Punch an enemy, dealing 2 - 4 damage', emoji: FIST_EMOJI }], !canAct)),
    row(selectMenu(`journey:items:${session.userId}:${session.id}`, 'Items', [{ label: 'No items yet', value: 'none', description: 'Items will be added later.' }], true)),
    row(selectMenu(`journey:strategies:${session.userId}:${session.id}`, 'Strategies', [{ label: 'No strategies yet', value: 'none', description: 'Strategies will be added later.' }], true)),
  ];
}
function targetRows(session) {
  const alive = session.enemies.filter((enemy) => enemy.hp > 0);
  const options = alive.map((enemy, index) => ({ label: `${enemy.name} ${index + 1}`, value: enemy.id, description: `HP ${enemy.hp}/${enemy.maxHp}`, emoji: SLIME_EMOJI_OBJECT }));
  return [
    row(selectMenu(`journey:target:${session.userId}:${session.id}`, 'Select enemy', options.length ? options : [{ label: 'No enemies left', value: 'none' }], options.length === 0)),
    row(button(`journey:back:${session.userId}:${session.id}`, 'Back', 2)),
  ];
}
async function battlePayload(session, accent = WHITE_ACCENT, disabled = false) {
  const image = await createBattleImage(session);
  return {
    flags: COMPONENTS_V2_FLAG,
    files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })],
    components: [{
      type: 17,
      accent_color: accent,
      components: [
        text(`## ${session.username} is doing stage ${stageSubtitle(session.stage)}`),
        mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`),
        text(session.actionLog.join('\n')),
        separator(),
        ...battleSelectRows(session, disabled),
      ],
    }],
  };
}
async function targetPayload(session) {
  const image = await createBattleImage(session);
  return {
    flags: COMPONENTS_V2_FLAG,
    files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })],
    components: [{
      type: 17,
      accent_color: WHITE_ACCENT,
      components: [text(`## ${session.username} is doing stage ${stageSubtitle(session.stage)}`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(session.actionLog.join('\n')), separator(), ...targetRows(session)],
    }],
  };
}
function addDrop(session, itemId, name, emoji, amount) {
  const existing = session.pendingDrops.find((drop) => drop.itemId === itemId);
  if (existing) existing.amount += amount;
  else session.pendingDrops.push({ itemId, name, emoji, amount });
}
function rollEnemyDrops(session, enemy) {
  if (enemy.dropsRolled) return;
  enemy.dropsRolled = true;
  addDrop(session, 'jungle_goo', 'Jungle Goo', GOO_EMOJI, 1);
  if (chance(0.1)) addDrop(session, 'jungle_goo', 'Jungle Goo', GOO_EMOJI, 2);
  session.enemyExp += 5;
}
function defenseReducedDamage(rawDamage, target) {
  const defense = Math.max(0, Math.min(10, Math.floor(Number(target.defense) || 0)));
  return Math.max(0, Math.floor(Number(rawDamage) * (1 - (defense * 0.10))));
}
function tickDefense(enemy) {
  if (!enemy.defenseTurns) return;
  enemy.defenseTurns = Math.max(0, enemy.defenseTurns - 1);
  if (enemy.defenseTurns <= 0) {
    enemy.defense = 0;
    enemy.status = '';
  }
}
async function sendPlayerLevelMessages(channel, userId, oldLevel, newLevel) {
  if (!channel?.isTextBased?.() || newLevel <= oldLevel) return;
  for (let level = oldLevel + 1; level <= newLevel; level += 1) {
    await channel.send({ allowedMentions: { parse: [] }, flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: GREEN_ACCENT, components: [text(`<@${userId}> has leveled up to player level ${level}!\n-# You earned 1 skill point.`)] }] }).catch(() => null);
  }
}
async function awardWinRewards(interaction, session) {
  const stageCoins = session.stageReward.coins;
  const stageExp = session.stageReward.exp;
  const enemyExp = session.enemyExp;
  const totalExp = stageExp + enemyExp;
  if (stageCoins > 0) addBalance(session.userId, stageCoins);
  for (const drop of session.pendingDrops) addInventoryItem(session.userId, drop.itemId, drop.amount);
  const xpResult = totalExp > 0 ? addPlayerXp(session.userId, totalExp) : { oldLevel: 1, newLevel: 1 };
  await sendPlayerLevelMessages(interaction.channel, session.userId, xpResult.oldLevel, xpResult.newLevel);
  return { stageCoins, stageExp, enemyExp, totalExp, drops: session.pendingDrops };
}
async function finishPayload(interaction, session, win) {
  const image = await createBattleImage(session);
  if (win) {
    const elapsedMs = Date.now() - session.startedAt;
    const stars = calcStars(session);
    setStageComplete(session.userId, session.stage.id, stars, elapsedMs, session.player.hp);
    const reward = await awardWinRewards(interaction, session);
    const dropText = reward.drops.length ? `\n-# Enemy drops:\n${reward.drops.map(formatDropLine).join('\n')}` : '';
    const enemyExpText = reward.enemyExp ? `\n-# Enemy exp: ${formatNumber(reward.enemyExp)} exp` : '';
    const reducedNote = session.wasStageCompleted ? '\n-# Stage prize reduced by 90% because this stage was already completed.' : '';
    return { flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })], components: [{ type: 17, accent_color: GREEN_ACCENT, components: [text(`## ${session.username} has defeated stage ${stageSubtitle(session.stage)}!`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(`${session.actionLog.join('\n')}\n-# Stage reward: ${formatNumber(reward.stageCoins)} ${COIN}, ${formatNumber(reward.stageExp)} exp.${enemyExpText}${dropText}\n-# Stars earned: ${'⭐'.repeat(stars)}${reducedNote}`), separator(), row(button(`journey:home:${session.userId}`, 'Home', 2))] }] };
  }
  return { flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })], components: [{ type: 17, accent_color: RED_ACCENT, components: [text(`## ${session.username} has failed stage ${stageSubtitle(session.stage)}!`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(`${session.actionLog.join('\n')}\n-# You have been defeated and lost all drops...`), separator(), row(button(`journey:retry:${session.userId}:${session.stage.id}`, 'Retry', 2), button(`journey:home:${session.userId}`, 'Home', 2))] }] };
}
function expandEnemies(enemies) {
  const out = [];
  for (const enemy of enemies || []) {
    const count = Math.max(1, Number(enemy.count) || 1);
    for (let i = 1; i <= count; i += 1) {
      out.push({ id: `${enemy.id || enemy.name}_${i}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, baseId: enemy.id, name: enemy.name || 'Enemy', emoji: enemy.emoji || '', imageUrl: enemy.imageUrl || SLIME_URL, rarity: enemy.rarity || 'Common', level: 1, hp: enemy.hp || 10, maxHp: enemy.hp || 10, power: 0, maxPower: enemy.maxPower || 10, defense: 0, defenseTurns: 0, status: '' });
    }
  }
  return out;
}
function createSession(interaction, stage) {
  const progress = getStageProgress(interaction.user.id, stage.id);
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    userId: interaction.user.id,
    username: interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
    stage,
    wasStageCompleted: progress.completed,
    stageReward: reducedReward(stage.reward, progress.completed),
    startedAt: Date.now(),
    turn: 'player',
    playerActions: 0,
    pendingAttack: null,
    actionLog: [`-# It's your turn`],
    pendingDrops: [],
    enemyExp: 0,
    player: { hp: 20, maxHp: 20, power: 0, maxPower: 10, level: stage.stage, status: '' },
    enemies: expandEnemies(stage.enemies),
    timers: [],
  };
}
function cleanupSession(session) { activeBattles.delete(session.id); for (const timer of session.timers || []) clearTimeout(timer); }
async function editBattleMessage(message, session, accent = WHITE_ACCENT, disabled = false) { await message.edit(await battlePayload(session, accent, disabled)).catch(() => null); }
function queueTimer(session, fn, delay) { const timer = setTimeout(fn, delay); session.timers.push(timer); }
function useJungleSlimeMove(enemy, session) {
  if (enemy.power >= 10) {
    enemy.defense = Math.min(10, Math.max(enemy.defense || 0, 1));
    enemy.defenseTurns = 2;
    enemy.power = Math.max(0, enemy.power - 10);
    enemy.status = `${DEFENSE_EMOJI} ${enemy.defense}`;
    return '-# Jungle Slime absorbs jungle leaves, gaining a protective shield last 2 turns.';
  }
  const damage = rand(2, 3);
  session.player.hp = Math.max(0, session.player.hp - damage);
  enemy.power = Math.min(enemy.maxPower, enemy.power + rand(1, 3));
  return `-# The Jungle Slime jumped toward ${session.username} and dealt ${damage} damage.`;
}
async function startEnemyTurn(interaction, session) {
  session.turn = 'enemy';
  session.pendingAttack = null;
  const alive = session.enemies.filter((enemy) => enemy.hp > 0);
  const firstHitDelay = 1800;
  const perEnemyDelay = 1600;
  const endDelay = firstHitDelay + (alive.length * perEnemyDelay) + 1000;
  session.actionLog.push(`-# Enemy turn ends <t:${Math.floor((Date.now() + endDelay) / 1000)}:R>`);
  await editBattleMessage(interaction.message, session, WHITE_ACCENT, true);
  alive.forEach((enemy, index) => {
    queueTimer(session, async () => {
      if (!activeBattles.has(session.id) || session.turn !== 'enemy' || enemy.hp <= 0) return;
      session.actionLog.push(useJungleSlimeMove(enemy, session));
      if (session.player.hp <= 0) {
        cleanupSession(session);
        await interaction.message.edit(await finishPayload(interaction, session, false)).catch(() => null);
        return;
      }
      await editBattleMessage(interaction.message, session, WHITE_ACCENT, true);
    }, firstHitDelay + (index * perEnemyDelay));
  });
  queueTimer(session, async () => {
    if (!activeBattles.has(session.id) || session.turn !== 'enemy') return;
    for (const enemy of session.enemies) tickDefense(enemy);
    session.turn = 'player';
    session.playerActions = 0;
    session.actionLog = [`-# It's your turn`];
    await editBattleMessage(interaction.message, session);
  }, endDelay);
}
async function applyPunch(interaction, session, targetId) {
  if (session.turn !== 'player') {
    await interaction.reply({ content: 'It is not your turn.', flags: EPHEMERAL_FLAG });
    return true;
  }
  await interaction.deferUpdate();
  const target = session.enemies.find((enemy) => enemy.id === targetId && enemy.hp > 0);
  if (!target) {
    await interaction.message.edit(await targetPayload(session)).catch(() => null);
    return true;
  }
  const rawDamage = rand(2, 4);
  const defense = Math.max(0, Math.min(10, Math.floor(Number(target.defense) || 0)));
  const damage = defenseReducedDamage(rawDamage, target);
  target.hp = Math.max(0, target.hp - damage);
  session.player.power = Math.min(session.player.maxPower, session.player.power + 2);
  session.playerActions += 1;
  session.pendingAttack = null;
  const defenseNote = defense > 0 ? ` (${rawDamage} reduced by defense)` : '';
  session.actionLog = [`-# ${session.username} used **Punch** onto **${target.name} ${target.emoji}** and deal ${damage} damage${defenseNote}.`];
  if (target.hp <= 0) {
    rollEnemyDrops(session, target);
    session.actionLog.push(`-# ${target.name} ${target.emoji} was defeated.`);
  }
  if (!session.enemies.some((enemy) => enemy.hp > 0)) {
    cleanupSession(session);
    await interaction.message.edit(await finishPayload(interaction, session, true)).catch(() => null);
    return true;
  }
  if (session.playerActions >= 2) {
    await startEnemyTurn(interaction, session);
    return true;
  }
  await editBattleMessage(interaction.message, session);
  return true;
}

module.exports = {
  bypassGlobalCooldown: true,
  data: new SlashCommandBuilder().setName('journey').setDescription('Select an adventure stage.'),
  async execute(interaction) {
    await interaction.deferReply();
    const stage = STAGES[0];
    const image = await createJourneyStageImage(stage, interaction.user.id);
    await interaction.editReply(homePayload(interaction, stage, new AttachmentBuilder(image, { name: STAGE_IMAGE_NAME })));
  },
  async handleInteraction(interaction) {
    if (!interaction.customId?.startsWith('journey:')) return false;
    const parts = interaction.customId.split(':');
    const action = parts[1];
    const userId = parts[2];
    if (userId && userId !== interaction.user.id) {
      await interaction.reply({ content: 'You can only use your own journey controls.', flags: EPHEMERAL_FLAG });
      return true;
    }
    if (action === 'home') {
      await interaction.deferUpdate();
      const stage = STAGES[0];
      const image = await createJourneyStageImage(stage, interaction.user.id);
      await interaction.message.edit(homePayload(interaction, stage, new AttachmentBuilder(image, { name: STAGE_IMAGE_NAME }))).catch(() => null);
      return true;
    }
    if (action === 'retry' || action === 'play') {
      await interaction.deferUpdate();
      const stage = STAGES.find((item) => item.id === parts[3]) || STAGES[0];
      const session = createSession(interaction, stage);
      activeBattles.set(session.id, session);
      await interaction.message.edit(await battlePayload(session)).catch(() => null);
      return true;
    }
    const session = activeBattles.get(parts[3]);
    if (!session) {
      await interaction.reply({ content: 'This battle is no longer active.', flags: EPHEMERAL_FLAG });
      return true;
    }
    if (action === 'attack') {
      if (interaction.values?.[0] === 'punch') {
        session.pendingAttack = 'punch';
        await interaction.update(await targetPayload(session));
        return true;
      }
      await interaction.reply({ content: 'That action is not ready yet.', flags: EPHEMERAL_FLAG });
      return true;
    }
    if (action === 'back') {
      await interaction.update(await battlePayload(session));
      return true;
    }
    if (action === 'target') return applyPunch(interaction, session, interaction.values?.[0]);
    return false;
  },
};
