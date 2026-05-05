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
const FIST_EMOJI = { id: '1500805602576826368', name: 'WPFist' };
const SLIME_EMOJI_OBJECT = { id: '1501095601432170506', name: 'ENJungleSlime' };
const SLIME_EMOJI = '<:ENJungleSlime:1501095601432170506>';
const SLIME_URL = 'https://cdn.discordapp.com/emojis/1501095601432170506.png?size=256&quality=lossless';
const DEFENSE_EMOJI = '<:SBDefense:1501156914665488486>';
const DEFENSE_URL = 'https://cdn.discordapp.com/emojis/1501156914665488486.png?size=128&quality=lossless';
const activeBattles = new Map();

const STAGES = [
  {
    id: 'jungle_entrance', name: 'Jungle Entrance', chapter: 1, stage: 1, stars: 0, completed: false,
    reward: { coins: 5, exp: 5 },
    enemies: [{ id: 'jungle_slime', name: 'Jungle Slime', emoji: SLIME_EMOJI, count: 2, hp: 10, maxPower: 10, rarity: 'Common', imageUrl: SLIME_URL }],
    drops: [
      { itemId: 'jungle_goo', name: 'Jungle Goo', emoji: '<:ITJungleGoo:1501156916737609798>', amount: 1, chance: 1 },
      { itemId: 'jungle_goo', name: 'Jungle Goo', emoji: '<:ITJungleGoo:1501156916737609798>', amount: 2, chance: 0.10 },
    ],
  },
  { id: 'mossy_ruins', name: 'Mossy Ruins', chapter: 1, stage: 2, stars: 0, completed: false, reward: { coins: 6, exp: 6 }, enemies: [{ id: 'jungle_slime', name: 'Jungle Slime', emoji: SLIME_EMOJI, count: 2, hp: 10, maxPower: 10, rarity: 'Common', imageUrl: SLIME_URL }], drops: [] },
  { id: 'ancient_canopy', name: 'Ancient Canopy', chapter: 1, stage: 3, stars: 0, completed: false, reward: { coins: 8, exp: 8 }, enemies: [{ id: 'jungle_slime', name: 'Jungle Slime', emoji: SLIME_EMOJI, count: 2, hp: 10, maxPower: 10, rarity: 'Common', imageUrl: SLIME_URL }], drops: [] },
];

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function selectMenu(customId, placeholder, options, disabled = false) { return { type: 3, custom_id: customId, placeholder, disabled, options }; }
function mediaGallery(url) { return { type: 12, items: [{ media: { url } }] }; }
function rand(min, max) { return Math.floor(Math.random() * ((max - min) + 1)) + min; }
function chance(probability) { return Math.random() < Number(probability || 0); }
function stageNumberLabel(value, fallback) { const n = Number(value); if (Number.isFinite(n) && n > 0) return Math.floor(n); const m = String(value || '').match(/\d+/); return m ? Number(m[0]) : fallback; }
function stageSubtitle(stage) { return `Chapter ${stageNumberLabel(stage.chapter, 1)} - ${stageNumberLabel(stage.stage, 1)}`; }
function formatStageReward(stage) { return `Stage reward: ${formatNumber(stage.reward?.coins || 0)} ${COIN}, ${formatNumber(stage.reward?.exp || 0)} exp.`; }
function setTextShadow(ctx, blur = 8) { ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = blur; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3; }
function clearTextShadow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
function strokedText(ctx, value, x, y, fillStyle, strokeStyle, strokeWidth = 6) { ctx.lineJoin = 'round'; ctx.strokeStyle = strokeStyle; ctx.lineWidth = strokeWidth; ctx.strokeText(value, x, y); ctx.fillStyle = fillStyle; ctx.fillText(value, x, y); }
function roundedRectPath(ctx, x, y, width, height, radius) { const r = Math.max(0, Math.min(radius, width / 2, height / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath(); }
function fitFont(ctx, value, maxWidth, startSize, minSize = 18, weight = 900) { let size = startSize; do { ctx.font = `${weight} ${size}px Arial`; if (ctx.measureText(value).width <= maxWidth) return size; size -= 2; } while (size >= minSize); return minSize; }
function strokeFitText(ctx, value, x, y, maxWidth, startSize, fill = '#fff', stroke = 'rgba(0,0,0,.82)', weight = 900, align = 'left') { ctx.textAlign = align; const size = fitFont(ctx, value, maxWidth, startSize, 16, weight); ctx.font = `${weight} ${size}px Arial`; strokedText(ctx, value, x, y, fill, stroke, Math.max(4, Math.round(size * .18))); }
function drawStar(ctx, cx, cy, outerRadius, innerRadius) { ctx.beginPath(); for (let i = 0; i < 10; i += 1) { const angle = (-Math.PI / 2) + (i * Math.PI / 5); const r = i % 2 === 0 ? outerRadius : innerRadius; const x = cx + Math.cos(angle) * r; const y = cy + Math.sin(angle) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); }
async function loadRemoteImage(url) { if (!url) return null; try { return await loadImage(url); } catch { return null; } }
function findBannerPath() { if (!fs.existsSync(IMAGES_DIR)) return null; const exact = fs.readdirSync(IMAGES_DIR).find((file) => path.parse(file).name.toLowerCase() === BANNER_BASENAME.toLowerCase()); return exact ? path.join(IMAGES_DIR, exact) : null; }
function createFallbackBanner() { const canvas = createCanvas(2048, 330); const ctx = canvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height); gradient.addColorStop(0, '#163d1d'); gradient.addColorStop(.5, '#3f8d42'); gradient.addColorStop(1, '#0b2a16'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height); return canvas; }
async function loadBannerCanvas() { const bannerPath = findBannerPath(); if (!bannerPath) return createFallbackBanner(); const banner = await loadImage(bannerPath); const canvas = createCanvas(banner.width, banner.height); canvas.getContext('2d').drawImage(banner, 0, 0); return canvas; }
function normalizeEnemies(enemies) { const byId = new Map(); for (const enemy of enemies || []) { const key = enemy.id || enemy.name; const current = byId.get(key) || { ...enemy, count: 0 }; current.count += Math.max(1, Number(enemy.count) || 1); byId.set(key, current); } return [...byId.values()]; }
function expandEnemies(enemies) { const out = []; for (const enemy of enemies || []) { const count = Math.max(1, Number(enemy.count) || 1); for (let i = 1; i <= count; i += 1) out.push({ id: `${enemy.id || enemy.name}_${i}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, baseId: enemy.id, name: enemy.name || 'Enemy', emoji: enemy.emoji || '', imageUrl: enemy.imageUrl || SLIME_URL, rarity: enemy.rarity || 'Common', level: 1, hp: enemy.hp || 10, maxHp: enemy.hp || 10, power: 0, maxPower: enemy.maxPower || 10, defense: 0, defenseTurns: 0, status: '' }); } return out; }
function aggregateDrops(drops) { const map = new Map(); for (const drop of drops || []) { const existing = map.get(drop.itemId) || { ...drop, amount: 0 }; existing.amount += Math.max(0, Math.floor(Number(drop.amount) || 0)); map.set(drop.itemId, existing); } return [...map.values()]; }
function formatDropLine(drop) { return `-# * ×${formatNumber(drop.amount)} ${drop.name} ${drop.emoji}`; }
function defenseReducedDamage(rawDamage, target) { const defense = Math.max(0, Math.min(10, Math.floor(Number(target.defense) || 0))); return Math.max(0, Math.floor(Number(rawDamage) * (1 - (defense * 0.10)))); }
function tickDefense(enemy) { if (!enemy.defenseTurns) return; enemy.defenseTurns = Math.max(0, enemy.defenseTurns - 1); if (enemy.defenseTurns <= 0) { enemy.defense = 0; enemy.status = ''; } }

function drawMapInfo(ctx, stage, width, height) {
  const scale = Math.max(.7, Math.min(width / 2048, height / 330));
  const left = Math.round(width * .035);
  const top = Math.round(height * .215);
  ctx.textBaseline = 'alphabetic'; setTextShadow(ctx, 13);
  ctx.font = `800 ${Math.round(50 * scale)}px Arial`; strokedText(ctx, 'MAP', left, top, '#f8fff0', 'rgba(0,0,0,.72)', Math.round(10 * scale));
  ctx.font = `900 ${Math.round(96 * scale)}px Arial`; strokedText(ctx, stage.name, left, top + Math.round(98 * scale), '#fff', 'rgba(0,0,0,.82)', Math.round(13 * scale));
  ctx.font = `800 ${Math.round(42 * scale)}px Arial`; strokedText(ctx, stageSubtitle(stage), left + Math.round(3 * scale), top + Math.round(160 * scale), '#f4ffe0', 'rgba(0,0,0,.72)', Math.round(10 * scale)); clearTextShadow(ctx);
  for (let i = 0; i < 3; i += 1) { const starX = left + Math.round((55 + (i * 122)) * scale); const starY = top + Math.round(226 * scale); drawStar(ctx, starX, starY, Math.round(52 * scale), Math.round(23 * scale)); ctx.fillStyle = i < Math.max(0, Math.min(3, stage.stars || 0)) ? '#f5c542' : '#000'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(3, Math.round(6 * scale)); ctx.stroke(); }
}
function drawSimpleProfileCircle(ctx, x, y, radius, image, fallback = '?', border = 'rgba(255,255,255,.9)') {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = Math.round(radius * .20); ctx.shadowOffsetY = Math.round(radius * .08); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = '#050505'; ctx.fill(); ctx.restore();
  if (image) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius - Math.max(5, Math.round(radius * .06)), 0, Math.PI * 2); ctx.clip(); ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2); ctx.restore(); }
  else { ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(radius * .70)}px Arial`; ctx.textAlign = 'center'; ctx.fillText(fallback, x, y + Math.round(radius * .25)); }
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.strokeStyle = border; ctx.lineWidth = Math.max(5, Math.round(radius * .08)); ctx.stroke();
}
async function drawEnemyList(ctx, stage, width, height) {
  const enemies = normalizeEnemies(stage.enemies).slice(0, 5);
  const image = await loadRemoteImage(SLIME_URL);
  const scale = Math.max(.7, Math.min(width / 2048, height / 330));
  const right = Math.round(width * .955);
  const circleY = Math.round(height * .58);
  const radius = Math.round(72 * scale);
  const gap = Math.round(radius * 2.2);
  const startX = right - ((enemies.length - 1) * gap) - radius;
  ctx.textAlign = 'right'; setTextShadow(ctx, 12); ctx.font = `900 ${Math.round(50 * scale)}px Arial`; strokedText(ctx, 'Enemies', right, Math.round(height * .30), '#fff', 'rgba(0,0,0,.82)', Math.round(10 * scale)); clearTextShadow(ctx);
  ctx.textAlign = 'center';
  enemies.forEach((enemy, index) => { const x = startX + (index * gap); drawSimpleProfileCircle(ctx, x, circleY, radius, image); setTextShadow(ctx, 10); strokeFitText(ctx, enemy.name, x, circleY + Math.round(radius * 1.44), Math.round(radius * 2.4), Math.round(radius * .38), '#fff', 'rgba(0,0,0,.9)', 800, 'center'); clearTextShadow(ctx); if (enemy.count > 1) { const badgeX = x + Math.round(48 * scale); const badgeY = circleY + Math.round(48 * scale); ctx.beginPath(); ctx.arc(badgeX, badgeY, Math.round(28 * scale), 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, Math.round(4 * scale)); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(22 * scale)}px Arial`; ctx.fillText(`x${enemy.count}`, badgeX, badgeY + Math.round(8 * scale)); } });
}
function drawVerticalRing(ctx, x, y, radius, value, max, color, width) { const percent = Math.max(0, Math.min(1, value / Math.max(1, max))); const lineRadius = radius - (width / 2); const segments = 180; ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = width; for (let i = 0; i < segments; i += 1) { const a1 = -Math.PI / 2 + (Math.PI * 2 * i / segments); const a2 = -Math.PI / 2 + (Math.PI * 2 * (i + 1.05) / segments); const mid = (a1 + a2) / 2; const midY = y + Math.sin(mid) * lineRadius; const cutoffY = (y - lineRadius) + (lineRadius * 2 * (1 - percent)); ctx.beginPath(); ctx.arc(x, y, lineRadius, a1, a2); ctx.strokeStyle = midY >= cutoffY ? color : '#050505'; ctx.stroke(); } ctx.restore(); }
function drawEnemyProfileCircle(ctx, { x, y, radius, image, defenseImage, dead = false, hp, maxHp, power = 0, maxPower = 1, defense = 0 }) {
  const hpWidth = Math.max(8, Math.round(radius * .075));
  const powWidth = Math.max(5, Math.round(radius * .05));
  const whiteWidth = Math.max(2, Math.round(radius * .024));
  const powerRadius = radius - hpWidth - Math.max(3, Math.round(radius * .025));
  const whiteRadius = powerRadius - powWidth - Math.max(2, Math.round(radius * .020));
  const contentRadius = whiteRadius - whiteWidth - 2;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = Math.round(radius * .20); ctx.shadowOffsetY = Math.round(radius * .08); ctx.beginPath(); ctx.arc(x, y, contentRadius, 0, Math.PI * 2); ctx.fillStyle = '#050505'; ctx.fill(); ctx.restore();
  if (!dead && image) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, contentRadius, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(image, x - contentRadius, y - contentRadius, contentRadius * 2, contentRadius * 2); ctx.restore(); }
  else if (!dead) { ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(radius * .65)}px Arial`; ctx.textAlign = 'center'; ctx.fillText('?', x, y + Math.round(radius * .22)); }
  if (!dead) { drawVerticalRing(ctx, x, y, radius, hp, maxHp, '#ff4040', hpWidth); if (power > 0) drawVerticalRing(ctx, x, y, powerRadius, power, maxPower, '#00ffff', powWidth); ctx.beginPath(); ctx.arc(x, y, whiteRadius, 0, Math.PI * 2); ctx.lineWidth = whiteWidth; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke(); if (defense > 0) { const badgeR = Math.round(radius * .22); const bx = x + Math.round(radius * .60); const by = y + Math.round(radius * .60); ctx.beginPath(); ctx.arc(bx, by, badgeR, 0, Math.PI * 2); ctx.fillStyle = '#050505'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, Math.round(radius * .025)); ctx.stroke(); if (defenseImage) ctx.drawImage(defenseImage, bx - badgeR + 3, by - badgeR + 3, (badgeR - 3) * 2, (badgeR - 3) * 2); ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(badgeR * .70)}px Arial`; ctx.textAlign = 'center'; ctx.fillText(String(defense), bx + Math.round(badgeR * .35), by + Math.round(badgeR * .43)); } }
  else { ctx.beginPath(); ctx.arc(x, y, radius - (hpWidth / 2), 0, Math.PI * 2); ctx.lineWidth = hpWidth; ctx.strokeStyle = '#050505'; ctx.stroke(); }
}
function drawStatLine(ctx, x, y, width, height, value, max, color, label) { const percent = Math.max(0, Math.min(1, value / Math.max(1, max))); roundedRectPath(ctx, x, y, width, height, height / 2); ctx.fillStyle = '#050505'; ctx.fill(); if (percent > 0) { roundedRectPath(ctx, x, y, Math.max(height, width * percent), height, height / 2); ctx.fillStyle = color; ctx.fill(); } ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = Math.max(2, Math.round(height * .12)); ctx.stroke(); if (label) { setTextShadow(ctx, 4); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `900 ${Math.round(height * .72)}px Arial`; ctx.fillText(label, x + width / 2, y + Math.round(height * .77)); clearTextShadow(ctx); } }
function enemyGrid(count) { if (count <= 1) return { cols: 1, rows: 1 }; if (count <= 2) return { cols: 2, rows: 1 }; if (count <= 4) return { cols: 2, rows: 2 }; return { cols: 3, rows: Math.ceil(count / 3) }; }
async function createJourneyStageImage(stage) { const canvas = await loadBannerCanvas(); const ctx = canvas.getContext('2d'); drawMapInfo(ctx, stage, canvas.width, canvas.height); await drawEnemyList(ctx, stage, canvas.width, canvas.height); return await canvas.encode('png'); }
function drawNameAndLevel(ctx, name, level, x, y, scale, align = 'left', maxWidth = 460) { setTextShadow(ctx, 13); strokeFitText(ctx, name, x, y, maxWidth, Math.round(52 * scale), '#fff', 'rgba(0,0,0,.82)', 900, align); strokeFitText(ctx, `Level ${level}`, x, y + Math.round(42 * scale), maxWidth, Math.round(30 * scale), '#fff', 'rgba(0,0,0,.82)', 900, align); clearTextShadow(ctx); }
async function createBattleImage(session) {
  const canvas = await loadBannerCanvas();
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const scale = Math.max(.7, Math.min(width / 2048, height / 330));
  const avatar = await loadRemoteImage(session.avatarUrl);
  const slimeImage = await loadRemoteImage(SLIME_URL);
  const defenseImage = await loadRemoteImage(DEFENSE_URL);

  const playerRadius = Math.round(118 * scale);
  const playerX = Math.round(width * .080);
  const playerY = Math.round(height * .54);
  const playerTextX = Math.round(width * .185);
  const playerTextY = Math.round(height * .23);
  drawSimpleProfileCircle(ctx, playerX, playerY, playerRadius, avatar, '?', 'rgba(255,255,255,.95)');
  drawNameAndLevel(ctx, session.username, session.player.level, playerTextX, playerTextY, scale, 'left', Math.round(width * .24));
  drawStatLine(ctx, playerTextX, playerTextY + Math.round(67 * scale), Math.round(505 * scale), Math.round(34 * scale), session.player.hp, session.player.maxHp, '#ff4040', `${session.player.hp}/${session.player.maxHp} HP`);
  drawStatLine(ctx, playerTextX, playerTextY + Math.round(114 * scale), Math.round(505 * scale), Math.round(34 * scale), session.player.power, session.player.maxPower, '#00ffff', `${session.player.power}/${session.player.maxPower} Power`);

  const grid = enemyGrid(Math.max(1, session.enemies.length));
  const areaX = Math.round(width * .55);
  const areaY = Math.round(height * .03);
  const areaW = Math.round(width * .34);
  const areaH = Math.round(height * .93);
  const cellW = areaW / grid.cols;
  const cellH = areaH / grid.rows;
  for (let index = 0; index < session.enemies.length; index += 1) {
    const enemy = session.enemies[index];
    const col = index % grid.cols;
    const row = Math.floor(index / grid.cols);
    const cellX = areaX + (col * cellW);
    const cellY = areaY + (row * cellH);
    const centerX = Math.round(cellX + (cellW * .50));
    const centerY = Math.round(cellY + (cellH * .40));
    const radius = Math.min(Math.round(112 * scale), Math.round(Math.min(cellW, cellH) * .36));
    drawEnemyProfileCircle(ctx, { x: centerX, y: centerY, radius, image: slimeImage, defenseImage, dead: enemy.hp <= 0, hp: enemy.hp, maxHp: enemy.maxHp, power: enemy.power, maxPower: enemy.maxPower, defense: enemy.defense });
    const textY = centerY + radius + Math.round(34 * scale);
    const maxTextWidth = Math.round(cellW * .94);
    drawNameAndLevel(ctx, enemy.name, enemy.level || 1, centerX, textY, Math.max(.56, scale * .68), 'center', maxTextWidth);
    if (enemy.status) { setTextShadow(ctx, 7); strokeFitText(ctx, enemy.status, centerX, textY + Math.round(68 * scale), maxTextWidth, Math.round(18 * scale), '#fff', 'rgba(0,0,0,.82)', 900, 'center'); clearTextShadow(ctx); }
  }
  return await canvas.encode('png');
}

function homePayload(interaction, stage, imageAttachment) { const completed = STAGES.filter((item) => item.completed).length; return { flags: COMPONENTS_V2_FLAG, files: imageAttachment ? [imageAttachment] : [], components: [{ type: 17, accent_color: WHITE_ACCENT, components: [text(`## ${interaction.user.username}'s Journey`), mediaGallery(`attachment://${STAGE_IMAGE_NAME}`), text(`-# You have completed ${completed} / ${STAGES.length} stages so far\n* ${formatStageReward(stage)}`), separator(), row(button(`journey:play:${interaction.user.id}:${stage.id}`, 'Play', 3), button(`journey:change:${interaction.user.id}`, 'Change Stages', 2, true)), row(selectMenu(`journey:chapter:${interaction.user.id}`, 'More Chapter soon', [{ label: 'More Chapter soon', value: 'soon', description: 'New chapters will be added later.' }], true))] }] }; }
function battleSelectRows(session, disabled = false) { const canAct = !disabled && session.turn === 'player'; return [row(selectMenu(`journey:attack:${session.userId}:${session.id}`, 'Attack', [{ label: 'Punch', value: 'punch', description: 'Punch an enemy, dealing 2 - 4 damage', emoji: FIST_EMOJI }], !canAct)), row(selectMenu(`journey:items:${session.userId}:${session.id}`, 'Items', [{ label: 'No items yet', value: 'none', description: 'Items will be added later.' }], true)), row(selectMenu(`journey:strategies:${session.userId}:${session.id}`, 'Strategies', [{ label: 'No strategies yet', value: 'none', description: 'Strategies will be added later.' }], true))]; }
function targetRows(session) { const alive = session.enemies.filter((enemy) => enemy.hp > 0); const options = alive.map((enemy, index) => ({ label: `${enemy.name} ${index + 1}`, value: enemy.id, description: `HP ${enemy.hp}/${enemy.maxHp}`, emoji: SLIME_EMOJI_OBJECT })); return [row(selectMenu(`journey:target:${session.userId}:${session.id}`, 'Select enemy', options.length ? options : [{ label: 'No enemies left', value: 'none' }], options.length === 0)), row(button(`journey:back:${session.userId}:${session.id}`, 'Back', 2))]; }
async function battlePayload(session, accent = WHITE_ACCENT, disabled = false) { const image = await createBattleImage(session); return { flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })], components: [{ type: 17, accent_color: accent, components: [text(`## ${session.username} is doing stage ${stageSubtitle(session.stage)}`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(session.actionLog.join('\n')), separator(), ...battleSelectRows(session, disabled)] }] }; }
async function targetPayload(session) { const image = await createBattleImage(session); return { flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })], components: [{ type: 17, accent_color: WHITE_ACCENT, components: [text(`## ${session.username} is doing stage ${stageSubtitle(session.stage)}`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(session.actionLog.join('\n')), separator(), ...targetRows(session)] }] }; }
function rollDrops(stage) { const rolled = []; for (const drop of stage.drops || []) if (chance(drop.chance)) rolled.push({ ...drop }); return aggregateDrops(rolled); }
async function sendPlayerLevelMessages(channel, userId, oldLevel, newLevel) { if (!channel?.isTextBased?.() || newLevel <= oldLevel) return; for (let level = oldLevel + 1; level <= newLevel; level += 1) await channel.send({ allowedMentions: { parse: [] }, flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: GREEN_ACCENT, components: [text(`<@${userId}> has leveled up to player level ${level}!\n-# You earned 1 skill point.`)] }] }).catch(() => null); }
async function awardWinRewards(interaction, session) { const coins = Math.max(0, Math.floor(Number(session.stage.reward?.coins) || 0)); const exp = Math.max(0, Math.floor(Number(session.stage.reward?.exp) || 0)); const drops = session.pendingDrops || []; if (coins > 0) addBalance(session.userId, coins); for (const drop of drops) addInventoryItem(session.userId, drop.itemId, drop.amount); const xpResult = exp > 0 ? addPlayerXp(session.userId, exp) : { oldLevel: 1, newLevel: 1 }; await sendPlayerLevelMessages(interaction.channel, session.userId, xpResult.oldLevel, xpResult.newLevel); return { coins, exp, drops }; }
async function finishPayload(interaction, session, win) { const image = await createBattleImage(session); let rewardText; if (win) { session.pendingDrops = rollDrops(session.stage); const reward = await awardWinRewards(interaction, session); const dropText = reward.drops.length ? `\n-# Enemy drops:\n${reward.drops.map(formatDropLine).join('\n')}` : ''; rewardText = `${session.actionLog.join('\n')}\n-# You have defeated all enemies and got ${formatNumber(reward.coins)} ${COIN}, ${formatNumber(reward.exp)} exp.${dropText}`; } else rewardText = `${session.actionLog.join('\n')}\n-# You have been defeated and lost all drops...`; return { flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })], components: [{ type: 17, accent_color: win ? GREEN_ACCENT : RED_ACCENT, components: [text(win ? `## ${session.username} has defeated stage ${stageSubtitle(session.stage)}!` : `## ${session.username} has failed stage ${stageSubtitle(session.stage)}!`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(rewardText), separator(), ...(win ? [row(button(`journey:home:${session.userId}`, 'Home', 2))] : [row(button(`journey:retry:${session.userId}:${session.stage.id}`, 'Retry', 2), button(`journey:home:${session.userId}`, 'Home', 2))])] }] }; }
function createSession(interaction, stage) { return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, userId: interaction.user.id, username: interaction.user.username, avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }), stage, turn: 'player', playerActions: 0, pendingAttack: null, actionLog: [`-# It's your turn`], pendingDrops: [], player: { hp: 20, maxHp: 20, power: 0, maxPower: 10, level: stageNumberLabel(stage.stage, 1), status: '' }, enemies: expandEnemies(stage.enemies), timers: [] }; }
function cleanupSession(session) { activeBattles.delete(session.id); for (const timer of session.timers || []) clearTimeout(timer); }
async function editBattleMessage(message, session, accent = WHITE_ACCENT, disabled = false) { await message.edit(await battlePayload(session, accent, disabled)).catch(() => null); }
function queueTimer(session, fn, delay) { const timer = setTimeout(fn, delay); session.timers.push(timer); }
function useJungleSlimeMove(enemy, session) { if (enemy.power >= 10) { enemy.defense = Math.min(10, Math.max(enemy.defense || 0, 1)); enemy.defenseTurns = 2; enemy.power = Math.max(0, enemy.power - 10); enemy.status = `${DEFENSE_EMOJI} ${enemy.defense}`; return '-# Jungle Slime absorbs jungle leaves, gaining a protective shield last 2 turns.'; } const damage = rand(2, 3); session.player.hp = Math.max(0, session.player.hp - damage); enemy.power = Math.min(enemy.maxPower, enemy.power + rand(1, 3)); return `-# The Jungle Slime jumped toward ${session.username} and dealt ${damage} damage.`; }
async function startEnemyTurn(interaction, session) { session.turn = 'enemy'; session.pendingAttack = null; session.actionLog.push(`-# Enemy turn <t:${Math.floor((Date.now() + 3000) / 1000)}:R>`); await editBattleMessage(interaction.message, session, WHITE_ACCENT, true); const alive = session.enemies.filter((enemy) => enemy.hp > 0); alive.forEach((enemy, index) => { queueTimer(session, async () => { if (!activeBattles.has(session.id) || session.turn !== 'enemy') return; session.actionLog.push(useJungleSlimeMove(enemy, session)); if (session.player.hp <= 0) { cleanupSession(session); await interaction.message.edit(await finishPayload(interaction, session, false)).catch(() => null); return; } await editBattleMessage(interaction.message, session, WHITE_ACCENT, true); }, 3000 + (index * 2000)); }); queueTimer(session, async () => { if (!activeBattles.has(session.id) || session.turn !== 'enemy') return; for (const enemy of session.enemies) tickDefense(enemy); session.turn = 'player'; session.playerActions = 0; session.actionLog = [`-# It's your turn`]; await editBattleMessage(interaction.message, session); }, 3000 + (alive.length * 2000) + 800); }
async function applyPunch(interaction, session, targetId) { if (session.turn !== 'player') { await interaction.reply({ content: 'It is not your turn.', flags: EPHEMERAL_FLAG }); return true; } await interaction.deferUpdate(); const target = session.enemies.find((enemy) => enemy.id === targetId && enemy.hp > 0); if (!target) { await interaction.message.edit(await targetPayload(session)).catch(() => null); return true; } const rawDamage = rand(2, 4); const damage = defenseReducedDamage(rawDamage, target); target.hp = Math.max(0, target.hp - damage); session.player.power = Math.min(session.player.maxPower, session.player.power + 2); session.playerActions += 1; session.pendingAttack = null; const defenseNote = target.defense > 0 ? ` (${rawDamage} reduced by defense)` : ''; session.actionLog = [`-# ${session.username} used **Punch** onto **${target.name} ${target.emoji}** and deal ${damage} damage${defenseNote}.`]; if (!session.enemies.some((enemy) => enemy.hp > 0)) { cleanupSession(session); await interaction.message.edit(await finishPayload(interaction, session, true)).catch(() => null); return true; } if (session.playerActions >= 2) { await startEnemyTurn(interaction, session); return true; } await editBattleMessage(interaction.message, session); return true; }

module.exports = {
  bypassGlobalCooldown: true,
  data: new SlashCommandBuilder().setName('journey').setDescription('Select an adventure stage.'),
  async execute(interaction) { await interaction.deferReply(); const stage = STAGES[0]; const image = await createJourneyStageImage(stage); await interaction.editReply(homePayload(interaction, stage, new AttachmentBuilder(image, { name: STAGE_IMAGE_NAME }))); },
  async handleInteraction(interaction) {
    if (!interaction.customId?.startsWith('journey:')) return false;
    const parts = interaction.customId.split(':'); const action = parts[1]; const userId = parts[2];
    if (userId && userId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own journey controls.', flags: EPHEMERAL_FLAG }); return true; }
    if (action === 'home') { await interaction.deferUpdate(); const stage = STAGES[0]; const image = await createJourneyStageImage(stage); await interaction.message.edit(homePayload(interaction, stage, new AttachmentBuilder(image, { name: STAGE_IMAGE_NAME }))).catch(() => null); return true; }
    if (action === 'retry' || action === 'play') { await interaction.deferUpdate(); const stage = STAGES.find((item) => item.id === parts[3]) || STAGES[0]; const session = createSession(interaction, stage); activeBattles.set(session.id, session); await interaction.message.edit(await battlePayload(session)).catch(() => null); return true; }
    const session = activeBattles.get(parts[3]);
    if (!session) { await interaction.reply({ content: 'This battle is no longer active.', flags: EPHEMERAL_FLAG }); return true; }
    if (action === 'attack') { if (interaction.values?.[0] === 'punch') { session.pendingAttack = 'punch'; await interaction.update(await targetPayload(session)); return true; } await interaction.reply({ content: 'That action is not ready yet.', flags: EPHEMERAL_FLAG }); return true; }
    if (action === 'back') { await interaction.update(await battlePayload(session)); return true; }
    if (action === 'target') return applyPunch(interaction, session, interaction.values?.[0]);
    return false;
  },
};
