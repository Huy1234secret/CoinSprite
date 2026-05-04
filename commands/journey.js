const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { WHITE_ACCENT } = require('../src/gamblingConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const STAGE_IMAGE_NAME = 'journey-stage.png';
const BATTLE_IMAGE_NAME = 'journey-battle.png';
const BANNER_BASENAME = 'JungleBanner';
const IMAGES_DIR = path.join(__dirname, '..', 'Images');
const FIST_EMOJI = { id: '1500805602576826368', name: 'WPFist' };
const IP_EMOJI = { id: '1494571122186915922', name: 'IP' };
const IP_EMOJI_URL = 'https://cdn.discordapp.com/emojis/1494571122186915922.png?size=256&quality=lossless';
const GREEN_ACCENT = 0x57f287;
const RED_ACCENT = 0xed4245;
const activeBattles = new Map();

const STAGES = [
  { id: 'jungle_entrance', name: 'Jungle Entrance', chapter: 1, stage: 1, stars: 0, completed: false, loots: [{ name: 'Jungle Leaf', emoji: '🍃', min: 1, max: 3 }, { name: 'Training Coin', emoji: '🪙', min: 2, max: 5 }], enemies: [{ id: 'slime', name: 'Slime', count: 2 }, { id: 'goblin', name: 'Goblin', count: 1 }, { id: 'bat', name: 'Bat', count: 1 }] },
  { id: 'mossy_ruins', name: 'Mossy Ruins', chapter: 1, stage: 2, stars: 0, completed: false, loots: [{ name: 'Moss Stone', emoji: '🪨', min: 1, max: 2 }, { name: 'Training Coin', emoji: '🪙', min: 3, max: 6 }], enemies: [{ id: 'goblin', name: 'Goblin', count: 2 }, { id: 'wolf', name: 'Wolf', count: 1 }] },
  { id: 'ancient_canopy', name: 'Ancient Canopy', chapter: 1, stage: 3, stars: 0, completed: false, loots: [{ name: 'Ancient Bark', emoji: '🪵', min: 1, max: 2 }, { name: 'Training Coin', emoji: '🪙', min: 5, max: 8 }], enemies: [{ id: 'bat', name: 'Bat', count: 2 }, { id: 'treant', name: 'Treant', count: 1 }] },
];

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function actionRow(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function selectMenu(customId, placeholder, options, disabled = false) { return { type: 3, custom_id: customId, placeholder, disabled, options }; }
function mediaGallery(url) { return { type: 12, items: [{ media: { url } }] }; }
function rand(min, max) { return Math.floor(Math.random() * ((max - min) + 1)) + min; }
function stageNumberLabel(value, fallback) { const n = Number(value); if (Number.isFinite(n) && n > 0) return Math.floor(n); const m = String(value || '').match(/\d+/); return m ? Number(m[0]) : fallback; }
function stageSubtitle(stage) { return `Chapter ${stageNumberLabel(stage.chapter, 1)} - ${stageNumberLabel(stage.stage, 1)}`; }
function formatLootDefinition(loots) { return loots.map((loot) => `-# * ×${loot.min}-${loot.max} ${loot.name} ${loot.emoji}`).join('\n'); }
function formatLootReward(loots) { return loots.map((loot) => `-# * ×${loot.amount} ${loot.name} ${loot.emoji}`).join('\n'); }
function findBannerPath() { if (!fs.existsSync(IMAGES_DIR)) return null; const exact = fs.readdirSync(IMAGES_DIR).find((file) => path.parse(file).name.toLowerCase() === BANNER_BASENAME.toLowerCase()); return exact ? path.join(IMAGES_DIR, exact) : null; }
function setTextShadow(ctx, blur = 8) { ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = blur; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3; }
function clearTextShadow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
function strokedText(ctx, value, x, y, fillStyle, strokeStyle, strokeWidth = 6) { ctx.lineJoin = 'round'; ctx.strokeStyle = strokeStyle; ctx.lineWidth = strokeWidth; ctx.strokeText(value, x, y); ctx.fillStyle = fillStyle; ctx.fillText(value, x, y); }
function roundedRectPath(ctx, x, y, width, height, radius) { const r = Math.max(0, Math.min(radius, width / 2, height / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath(); }
function drawStar(ctx, cx, cy, outerRadius, innerRadius) { ctx.beginPath(); for (let i = 0; i < 10; i += 1) { const angle = (-Math.PI / 2) + (i * Math.PI / 5); const radius = i % 2 === 0 ? outerRadius : innerRadius; const x = cx + Math.cos(angle) * radius; const y = cy + Math.sin(angle) * radius; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); }
function normalizeEnemies(enemies) { const byId = new Map(); for (const enemy of enemies || []) { const key = enemy.id || enemy.name; const current = byId.get(key) || { ...enemy, count: 0 }; current.count += Math.max(1, Number(enemy.count) || 1); byId.set(key, current); } return [...byId.values()]; }
function expandEnemies(enemies) { const out = []; for (const enemy of enemies || []) { const count = Math.max(1, Number(enemy.count) || 1); for (let i = 1; i <= count; i += 1) out.push({ id: `${enemy.id || enemy.name}_${i}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: enemy.name || 'Enemy', hp: 3, maxHp: 3, power: 0, maxPower: 3, status: '' }); } return out; }
function createFallbackBanner() { const canvas = createCanvas(2048, 330); const ctx = canvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height); gradient.addColorStop(0, '#163d1d'); gradient.addColorStop(.5, '#3f8d42'); gradient.addColorStop(1, '#0b2a16'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height); return canvas; }
async function loadBannerCanvas() { const bannerPath = findBannerPath(); if (!bannerPath) return createFallbackBanner(); const banner = await loadImage(bannerPath); const canvas = createCanvas(banner.width, banner.height); canvas.getContext('2d').drawImage(banner, 0, 0); return canvas; }
async function loadRemoteImage(url) { if (!url) return null; try { return await loadImage(url); } catch { return null; } }

function drawMapInfo(ctx, stage, width, height) {
  const scale = Math.max(.7, Math.min(width / 2048, height / 330));
  const left = Math.round(width * .035);
  const top = Math.round(height * .215);
  ctx.textBaseline = 'alphabetic';
  setTextShadow(ctx, 13);
  ctx.font = `800 ${Math.round(50 * scale)}px Arial`; strokedText(ctx, 'MAP', left, top, '#f8fff0', 'rgba(0,0,0,.72)', Math.round(10 * scale));
  ctx.font = `900 ${Math.round(96 * scale)}px Arial`; strokedText(ctx, stage.name, left, top + Math.round(98 * scale), '#fff', 'rgba(0,0,0,.82)', Math.round(13 * scale));
  ctx.font = `800 ${Math.round(42 * scale)}px Arial`; strokedText(ctx, stageSubtitle(stage), left + Math.round(3 * scale), top + Math.round(160 * scale), '#f4ffe0', 'rgba(0,0,0,.72)', Math.round(10 * scale));
  clearTextShadow(ctx);
  for (let i = 0; i < 3; i += 1) { const starX = left + Math.round((55 + (i * 122)) * scale); const starY = top + Math.round(226 * scale); drawStar(ctx, starX, starY, Math.round(52 * scale), Math.round(23 * scale)); ctx.fillStyle = i < Math.max(0, Math.min(3, stage.stars || 0)) ? '#f5c542' : '#000'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(3, Math.round(6 * scale)); ctx.stroke(); }
}

function drawHomeProfileCircle(ctx, x, y, radius, label, image) {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = Math.round(radius * .22); ctx.shadowOffsetY = Math.round(radius * .10); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = 'rgba(18,18,18,.9)'; ctx.fill(); ctx.restore();
  if (image) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius - 6, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(image, x - radius + 6, y - radius + 6, (radius - 6) * 2, (radius - 6) * 2); ctx.restore(); }
  else { ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(radius * .72)}px Arial`; ctx.textAlign = 'center'; ctx.fillText('?', x, y + Math.round(radius * .25)); }
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.88)'; ctx.lineWidth = Math.max(5, Math.round(radius * .09)); ctx.stroke();
  if (label) { setTextShadow(ctx, 10); ctx.font = `800 ${Math.round(radius * .42)}px Arial`; strokedText(ctx, label, x, y + Math.round(radius * 1.52), '#fff', 'rgba(0,0,0,.9)', Math.round(radius * .10)); clearTextShadow(ctx); }
}

async function drawEnemyList(ctx, stage, width, height) {
  const enemies = normalizeEnemies(stage.enemies).slice(0, 5);
  const enemyImage = await loadRemoteImage(IP_EMOJI_URL);
  const scale = Math.max(.7, Math.min(width / 2048, height / 330));
  const right = Math.round(width * .955); const titleY = Math.round(height * .30); const circleY = Math.round(height * .58); const radius = Math.round(78 * scale); const gap = Math.round(176 * scale); const startX = right - ((enemies.length - 1) * gap) - radius;
  ctx.textAlign = 'right'; setTextShadow(ctx, 12); ctx.font = `900 ${Math.round(50 * scale)}px Arial`; strokedText(ctx, 'Enemies', right, titleY, '#fff', 'rgba(0,0,0,.82)', Math.round(10 * scale)); clearTextShadow(ctx);
  ctx.textAlign = 'center';
  enemies.forEach((enemy, index) => {
    const x = startX + (index * gap); drawHomeProfileCircle(ctx, x, circleY, radius, enemy.name, enemyImage);
    if (enemy.count > 1) { const badgeX = x + Math.round(56 * scale); const badgeY = circleY + Math.round(54 * scale); ctx.beginPath(); ctx.arc(badgeX, badgeY, Math.round(36 * scale), 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, Math.round(5 * scale)); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(27 * scale)}px Arial`; ctx.fillText(`x${enemy.count}`, badgeX, badgeY + Math.round(9 * scale)); }
  });
  ctx.textAlign = 'left';
}

function drawVerticalRing(ctx, x, y, radius, value, max, color, width) {
  const percent = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const lineRadius = radius - (width / 2);
  const segments = 240;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = width;
  for (let i = 0; i < segments; i += 1) {
    const a1 = -Math.PI / 2 + (Math.PI * 2 * i / segments);
    const a2 = -Math.PI / 2 + (Math.PI * 2 * (i + 1.05) / segments);
    const mid = (a1 + a2) / 2;
    const midY = y + Math.sin(mid) * lineRadius;
    const cutoffY = (y - lineRadius) + (lineRadius * 2 * (1 - percent));
    ctx.beginPath(); ctx.arc(x, y, lineRadius, a1, a2); ctx.strokeStyle = midY >= cutoffY ? color : '#050505'; ctx.stroke();
  }
  ctx.restore();
}

function drawProfileCircle(ctx, { x, y, radius, image, dead = false, hp, maxHp, power = 0, maxPower = 1, healthWidth, powerWidth, whiteWidth, drawPowerRing = false }) {
  const hpWidth = healthWidth || Math.max(8, Math.round(radius * .12));
  const powWidth = powerWidth || Math.max(4, Math.round(radius * .052));
  const innerWhiteWidth = whiteWidth || Math.max(2, Math.round(radius * .025));
  const hpRadius = radius;
  const powerRadius = radius - hpWidth - Math.max(2, Math.round(radius * .03));
  const whiteRadius = powerRadius - powWidth - Math.max(2, Math.round(radius * .02));
  const contentRadius = whiteRadius - innerWhiteWidth - 4;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = Math.round(radius * .24); ctx.shadowOffsetY = Math.round(radius * .10); ctx.beginPath(); ctx.arc(x, y, contentRadius, 0, Math.PI * 2); ctx.fillStyle = '#050505'; ctx.fill(); ctx.restore();
  if (!dead && image) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, contentRadius, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(image, x - contentRadius, y - contentRadius, contentRadius * 2, contentRadius * 2); ctx.restore(); }
  else if (!dead) { ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(radius * .7)}px Arial`; ctx.textAlign = 'center'; ctx.fillText('?', x, y + Math.round(radius * .24)); }
  if (!dead) {
    drawVerticalRing(ctx, x, y, hpRadius, hp, maxHp, '#ff4040', hpWidth);
    if (drawPowerRing && power > 0) drawVerticalRing(ctx, x, y, powerRadius, power, maxPower, '#00ffff', powWidth);
    ctx.beginPath(); ctx.arc(x, y, whiteRadius, 0, Math.PI * 2); ctx.lineWidth = innerWhiteWidth; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x, y, radius - (hpWidth / 2), 0, Math.PI * 2); ctx.lineWidth = hpWidth; ctx.strokeStyle = '#050505'; ctx.stroke();
  }
}

function drawStatLine(ctx, x, y, width, height, value, max, color, label) {
  const percent = Math.max(0, Math.min(1, value / Math.max(1, max))); roundedRectPath(ctx, x, y, width, height, height / 2); ctx.fillStyle = '#050505'; ctx.fill();
  if (percent > 0) { roundedRectPath(ctx, x, y, Math.max(height, width * percent), height, height / 2); ctx.fillStyle = color; ctx.fill(); }
  ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = Math.max(2, Math.round(height * .12)); ctx.stroke();
  if (label) { setTextShadow(ctx, 4); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `900 ${Math.round(height * .72)}px Arial`; ctx.fillText(label, x + width / 2, y + Math.round(height * .77)); clearTextShadow(ctx); }
}

function enemyGrid(count) { if (count <= 1) return { cols: 1, rows: 1 }; if (count <= 2) return { cols: 2, rows: 1 }; if (count <= 4) return { cols: 2, rows: 2 }; if (count <= 6) return { cols: 3, rows: 2 }; if (count <= 9) return { cols: 3, rows: 3 }; return { cols: 4, rows: Math.ceil(count / 4) }; }
async function createJourneyStageImage(stage) { const canvas = await loadBannerCanvas(); const ctx = canvas.getContext('2d'); drawMapInfo(ctx, stage, canvas.width, canvas.height); await drawEnemyList(ctx, stage, canvas.width, canvas.height); return canvas.encode('png'); }

async function createBattleImage(session) {
  const canvas = await loadBannerCanvas(); const ctx = canvas.getContext('2d'); const width = canvas.width; const height = canvas.height; const scale = Math.max(.7, Math.min(width / 2048, height / 330)); const avatar = await loadRemoteImage(session.avatarUrl); const enemyImage = await loadRemoteImage(IP_EMOJI_URL);
  const left = Math.round(width * .025); const top = Math.round(height * .14);
  setTextShadow(ctx, 13); ctx.textAlign = 'left'; ctx.font = `900 ${Math.round(58 * scale)}px Arial`; strokedText(ctx, session.username, left, top, '#fff', 'rgba(0,0,0,.82)', Math.round(10 * scale)); ctx.font = `900 ${Math.round(31 * scale)}px Arial`; strokedText(ctx, `Level ${session.player.level}`, left + Math.round(285 * scale), top + Math.round(76 * scale), '#fff', 'rgba(0,0,0,.82)', Math.round(6 * scale)); clearTextShadow(ctx);
  const playerRadius = Math.round(122 * scale); const playerX = left + Math.round(125 * scale); const playerY = top + Math.round(132 * scale); drawProfileCircle(ctx, { x: playerX, y: playerY, radius: playerRadius, image: avatar, hp: session.player.hp, maxHp: session.player.maxHp, power: 0, maxPower: session.player.maxPower, drawPowerRing: false, healthWidth: Math.round(13 * scale), powerWidth: Math.round(6 * scale), whiteWidth: Math.round(4 * scale) });
  const statX = left + Math.round(285 * scale); drawStatLine(ctx, statX, top + Math.round(101 * scale), Math.round(455 * scale), Math.round(27 * scale), session.player.hp, session.player.maxHp, '#ff4040', `${session.player.hp}/${session.player.maxHp} HP`); drawStatLine(ctx, statX, top + Math.round(141 * scale), Math.round(455 * scale), Math.round(27 * scale), session.player.power, session.player.maxPower, '#00ffff', `${session.player.power}/${session.player.maxPower} Power`);
  if (session.player.status) { setTextShadow(ctx, 8); ctx.font = `900 ${Math.round(25 * scale)}px Arial`; strokedText(ctx, session.player.status, left, top + Math.round(245 * scale), '#fff', 'rgba(0,0,0,.82)', Math.round(5 * scale)); clearTextShadow(ctx); }
  const grid = enemyGrid(Math.max(1, session.enemies.length)); const areaX = Math.round(width * .47); const areaY = Math.round(height * .04); const areaW = Math.round(width * .50); const areaH = Math.round(height * .92); const cellW = areaW / grid.cols; const cellH = areaH / grid.rows;
  session.enemies.forEach((enemy, index) => { const col = index % grid.cols; const row = Math.floor(index / grid.cols); const centerX = Math.round(areaX + (col * cellW) + (cellW / 2)); const centerY = Math.round(areaY + (row * cellH) + (cellH * .40)); const radius = Math.min(Math.round(124 * scale), Math.round(Math.min(cellW, cellH) * .43)); drawProfileCircle(ctx, { x: centerX, y: centerY, radius, image: enemyImage, dead: enemy.hp <= 0, hp: enemy.hp, maxHp: enemy.maxHp, power: enemy.power, maxPower: enemy.maxPower, healthWidth: Math.round(14 * scale), powerWidth: Math.round(7 * scale), whiteWidth: Math.round(4 * scale), drawPowerRing: true }); if (enemy.status) { setTextShadow(ctx, 7); ctx.font = `900 ${Math.round(18 * scale)}px Arial`; strokedText(ctx, enemy.status, centerX, centerY + radius + Math.round(35 * scale), '#fff', 'rgba(0,0,0,.82)', Math.round(4 * scale)); clearTextShadow(ctx); } });
  return canvas.encode('png');
}

function homePayload(interaction, stage, imageAttachment) { const completed = STAGES.filter((item) => item.completed).length; return { flags: COMPONENTS_V2_FLAG, files: imageAttachment ? [imageAttachment] : [], components: [{ type: 17, accent_color: WHITE_ACCENT, components: [text(`## ${interaction.user.username}'s Journey`), mediaGallery(`attachment://${STAGE_IMAGE_NAME}`), text(`-# You have completed ${completed} / ${STAGES.length} stages so far\n* Stage loots:\n${formatLootDefinition(stage.loots)}`), separator(), actionRow(button(`journey:play:${interaction.user.id}:${stage.id}`, 'Play', 3), button(`journey:change:${interaction.user.id}`, 'Change Stages', 2, true)), actionRow(selectMenu(`journey:chapter:${interaction.user.id}`, 'More Chapter soon', [{ label: 'More Chapter soon', value: 'soon', description: 'New chapters will be added later.' }], true))] }] }; }
function battleSelectRows(session, disabled = false) { const canAct = !disabled && session.turn === 'player'; return [actionRow(selectMenu(`journey:attack:${session.userId}:${session.id}`, 'Attack', [{ label: 'Punch', value: 'punch', description: 'Punch an enemy, dealing 2 - 4 damage', emoji: FIST_EMOJI }], !canAct)), actionRow(selectMenu(`journey:items:${session.userId}:${session.id}`, 'Items', [{ label: 'No items yet', value: 'none', description: 'Items will be added later.' }], true)), actionRow(selectMenu(`journey:strategies:${session.userId}:${session.id}`, 'Strategies', [{ label: 'No strategies yet', value: 'none', description: 'Strategies will be added later.' }], true))]; }
function targetRows(session) { const alive = session.enemies.filter((enemy) => enemy.hp > 0); const options = alive.map((enemy, index) => ({ label: `${enemy.name} ${index + 1}`, value: enemy.id, description: `HP ${enemy.hp}/${enemy.maxHp}`, emoji: IP_EMOJI })); return [actionRow(selectMenu(`journey:target:${session.userId}:${session.id}`, 'Select enemy', options.length ? options : [{ label: 'No enemies left', value: 'none' }], options.length === 0)), actionRow(button(`journey:back:${session.userId}:${session.id}`, 'Back', 2))]; }
async function battlePayload(session, accent = WHITE_ACCENT, disabled = false) { const image = await createBattleImage(session); return { flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })], components: [{ type: 17, accent_color: accent, components: [text(`## ${session.username} is doing stage ${stageSubtitle(session.stage)}`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(session.actionLog.join('\n')), separator(), ...battleSelectRows(session, disabled)] }] }; }
async function targetPayload(session) { const image = await createBattleImage(session); return { flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })], components: [{ type: 17, accent_color: WHITE_ACCENT, components: [text(`## ${session.username} is doing stage ${stageSubtitle(session.stage)}`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(session.actionLog.join('\n')), separator(), ...targetRows(session)] }] }; }
async function finishPayload(session, win) { const loots = session.stage.loots.map((loot) => ({ ...loot, amount: rand(loot.min, loot.max) })); const image = await createBattleImage(session); return { flags: COMPONENTS_V2_FLAG, files: [new AttachmentBuilder(image, { name: BATTLE_IMAGE_NAME })], components: [{ type: 17, accent_color: win ? GREEN_ACCENT : RED_ACCENT, components: [text(win ? `## ${session.username} has defeated stage ${stageSubtitle(session.stage)}!` : `## ${session.username} has failed stage ${stageSubtitle(session.stage)}!`), mediaGallery(`attachment://${BATTLE_IMAGE_NAME}`), text(win ? `${session.actionLog.join('\n')}\n-# You have defeated all enemies and got:\n${formatLootReward(loots)}` : `${session.actionLog.join('\n')}\n-# You have been defeated...`), separator(), ...(win ? [actionRow(button(`journey:home:${session.userId}`, 'Home', 2))] : [actionRow(button(`journey:retry:${session.userId}:${session.stage.id}`, 'Retry', 2), button(`journey:home:${session.userId}`, 'Home', 2))])] }] }; }
function createSession(interaction, stage) { return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, userId: interaction.user.id, username: interaction.user.username, avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }), stage, turn: 'player', playerActions: 0, pendingAttack: null, actionLog: [`-# It's your turn`], player: { hp: 20, maxHp: 20, power: 0, maxPower: 10, level: stageNumberLabel(stage.stage, 1), status: '' }, enemies: expandEnemies(stage.enemies), timers: [] }; }
function cleanupSession(session) { activeBattles.delete(session.id); for (const timer of session.timers || []) clearTimeout(timer); }
async function editBattleMessage(message, session, accent = WHITE_ACCENT, disabled = false) { await message.edit(await battlePayload(session, accent, disabled)).catch(() => null); }
function queueTimer(session, fn, delay) { const timer = setTimeout(fn, delay); session.timers.push(timer); }
async function startEnemyTurn(interaction, session) { session.turn = 'enemy'; session.pendingAttack = null; session.actionLog.push(`-# Enemy turn <t:${Math.floor((Date.now() + 3000) / 1000)}:R>`); await editBattleMessage(interaction.message, session, WHITE_ACCENT, true); const alive = session.enemies.filter((enemy) => enemy.hp > 0); alive.forEach((enemy, index) => { queueTimer(session, async () => { if (!activeBattles.has(session.id) || session.turn !== 'enemy') return; let damage = 1; let attackName = 'Punch'; enemy.power = Math.min(enemy.maxPower, enemy.power + 1); if (enemy.power >= enemy.maxPower) { attackName = 'Power Punch'; damage = 3; enemy.power = 0; } session.player.hp = Math.max(0, session.player.hp - damage); session.actionLog.push(`-# ${enemy.name} <:IP:1494571122186915922> used **${attackName}** and dealt ${damage} damage.`); if (session.player.hp <= 0) { cleanupSession(session); await interaction.message.edit(await finishPayload(session, false)).catch(() => null); return; } await editBattleMessage(interaction.message, session, WHITE_ACCENT, true); }, 3000 + (index * 2000)); }); queueTimer(session, async () => { if (!activeBattles.has(session.id) || session.turn !== 'enemy') return; session.turn = 'player'; session.playerActions = 0; session.actionLog = [`-# It's your turn`]; await editBattleMessage(interaction.message, session); }, 3000 + (alive.length * 2000) + 800); }
async function applyPunch(interaction, session, targetId) { if (session.turn !== 'player') { await interaction.reply({ content: 'It is not your turn.', flags: EPHEMERAL_FLAG }); return true; } await interaction.deferUpdate(); const target = session.enemies.find((enemy) => enemy.id === targetId && enemy.hp > 0); if (!target) { await interaction.message.edit(await targetPayload(session)).catch(() => null); return true; } const damage = rand(2, 4); target.hp = Math.max(0, target.hp - damage); session.player.power = Math.min(session.player.maxPower, session.player.power + 2); session.playerActions += 1; session.pendingAttack = null; session.actionLog = [`-# ${session.username} used **Punch** onto **${target.name} <:IP:1494571122186915922>** and deal ${damage} damage.`]; if (!session.enemies.some((enemy) => enemy.hp > 0)) { cleanupSession(session); await interaction.message.edit(await finishPayload(session, true)).catch(() => null); return true; } if (session.playerActions >= 2) { await startEnemyTurn(interaction, session); return true; } await editBattleMessage(interaction.message, session); return true; }

module.exports = { bypassGlobalCooldown: true, data: new SlashCommandBuilder().setName('journey').setDescription('Select an adventure stage.'), async execute(interaction) { await interaction.deferReply(); const stage = STAGES[0]; const image = await createJourneyStageImage(stage); await interaction.editReply(homePayload(interaction, stage, new AttachmentBuilder(image, { name: STAGE_IMAGE_NAME }))); }, async handleInteraction(interaction) { if (!interaction.customId?.startsWith('journey:')) return false; const parts = interaction.customId.split(':'); const action = parts[1]; const userId = parts[2]; if (userId && userId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own journey controls.', flags: EPHEMERAL_FLAG }); return true; } if (action === 'home') { await interaction.deferUpdate(); const stage = STAGES[0]; const image = await createJourneyStageImage(stage); await interaction.message.edit(homePayload(interaction, stage, new AttachmentBuilder(image, { name: STAGE_IMAGE_NAME }))).catch(() => null); return true; } if (action === 'retry' || action === 'play') { await interaction.deferUpdate(); const stage = STAGES.find((item) => item.id === parts[3]) || STAGES[0]; const session = createSession(interaction, stage); activeBattles.set(session.id, session); await interaction.message.edit(await battlePayload(session)).catch(() => null); return true; } if (action === 'attack') { const session = activeBattles.get(parts[3]); if (!session || session.userId !== interaction.user.id) { await interaction.reply({ content: 'This journey battle is no longer active.', flags: EPHEMERAL_FLAG }); return true; } if (interaction.values?.[0] === 'punch') { await interaction.deferUpdate(); session.pendingAttack = 'punch'; await interaction.message.edit(await targetPayload(session)).catch(() => null); return true; } } if (action === 'target') { const session = activeBattles.get(parts[3]); if (!session || session.userId !== interaction.user.id) { await interaction.reply({ content: 'This journey battle is no longer active.', flags: EPHEMERAL_FLAG }); return true; } if (interaction.values?.[0] && interaction.values[0] !== 'none') return applyPunch(interaction, session, interaction.values[0]); } if (action === 'back') { const session = activeBattles.get(parts[3]); if (!session || session.userId !== interaction.user.id) { await interaction.reply({ content: 'This journey battle is no longer active.', flags: EPHEMERAL_FLAG }); return true; } await interaction.deferUpdate(); session.pendingAttack = null; await editBattleMessage(interaction.message, session); return true; } await interaction.reply({ content: 'More stages and chapters are coming soon.', flags: EPHEMERAL_FLAG }); return true; } };
