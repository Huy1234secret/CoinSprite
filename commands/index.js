const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { FISHES, RARITY_LABELS, emojiUrl } = require('../src/fishingConfig');
const { getInventory } = require('../src/fishingStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const INDEX_CACHE_DIR = path.join(__dirname, '..', 'data', 'index-gallery');
const EMOJI_CACHE_DIR = path.join(INDEX_CACHE_DIR, 'emoji-cache');
const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythical', 'secret'];
const RARITY_COLORS = {
  common: '#d7dce2',
  rare: '#58a6ff',
  epic: '#bf7af0',
  legendary: '#f2cc60',
  mythical: '#ff73c7',
  secret: '#7df9ff',
};
const FISH_IDS = new Set(FISHES.map((fish) => fish.id));

function ensureCacheDir() {
  fs.mkdirSync(INDEX_CACHE_DIR, { recursive: true });
  fs.mkdirSync(EMOJI_CACHE_DIR, { recursive: true });
}

function getDiscoveredFish(userId) {
  const inventory = getInventory(userId);
  return Object.keys(inventory).filter((itemId) => FISH_IDS.has(itemId) && Math.max(0, Math.floor(Number(inventory[itemId]) || 0)) > 0);
}

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, disabled = false) { return { type: 2, custom_id: customId, label, style: 2, disabled }; }
function ownerFromId(customId) { return String(customId || '').split(':')[2]; }

function categorySelect(userId, selected = null) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `index:category:${userId}:${selected || 'home'}`,
      placeholder: 'Select category',
      min_values: 1,
      max_values: 1,
      options: [{ label: 'Fish Index', value: 'fish', emoji: { name: '🐟' }, default: selected === 'fish' }],
    }],
  };
}

function payload(components, files = []) {
  const data = { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: 0xffffff, components }] };
  if (files.length) data.files = files;
  return data;
}

function buildHomePayload(interaction) {
  return payload([
    text(`Welcome ${interaction.user} to Index!\n* Select a category to view it index`),
    separator(),
    categorySelect(interaction.user.id),
  ]);
}

function formatChance(value) {
  const n = Number(value) || 0;
  if (n < 1) return '???';
  return `${n.toFixed(2).replace(/\.00$/, '')}%`;
}

function fitText(ctx, textValue, maxWidth, fontSize, minSize = 14) {
  let size = fontSize;
  do {
    ctx.font = `bold ${size}px sans-serif`;
    if (ctx.measureText(textValue).width <= maxWidth) return size;
    size -= 1;
  } while (size >= minSize);
  return minSize;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function getEmojiId(emoji) {
  return String(emoji || '').match(/<a?:\w+:(\d+)>/)?.[1] || null;
}

function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        file.close(() => fs.unlink(filePath, () => reject(new Error(`HTTP ${response.statusCode}`))));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (error) => {
      file.close(() => fs.unlink(filePath, () => reject(error)));
    });
  });
}

async function loadFishImage(fish) {
  const url = emojiUrl(fish.emoji);
  const id = getEmojiId(fish.emoji);
  if (!url || !id) return null;
  const filePath = path.join(EMOJI_CACHE_DIR, `${id}.png`);
  if (!fs.existsSync(filePath)) await downloadFile(url, filePath).catch(() => null);
  if (fs.existsSync(filePath)) {
    try { return await loadImage(filePath); } catch {}
  }
  try { return await loadImage(url); } catch { return null; }
}

function drawBlackSilhouette(ctx, image, x, y, size) {
  const tmp = createCanvas(size, size);
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.drawImage(image, 0, 0, size, size);
  tmpCtx.globalCompositeOperation = 'source-in';
  tmpCtx.fillStyle = '#000000';
  tmpCtx.fillRect(0, 0, size, size);
  ctx.drawImage(tmp, x, y, size, size);
}

async function drawFishIcon(ctx, fish, x, y, size, discovered) {
  const image = await loadFishImage(fish);
  if (image) {
    if (discovered) ctx.drawImage(image, x, y, size, size);
    else drawBlackSilhouette(ctx, image, x, y, size);
    return;
  }
  ctx.save();
  ctx.font = `${Math.floor(size * 0.78)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = discovered ? '#ffffff' : '#000000';
  ctx.fillText('🐟', x + size / 2, y + size / 2);
  ctx.restore();
}

function galleryCachePath(userId, rarity, discoveredSet) {
  const discoveredKey = FISHES.filter((fish) => discoveredSet.has(fish.id)).map((fish) => fish.id).join('|');
  const hash = crypto.createHash('sha1').update(`${rarity}:${discoveredKey}`).digest('hex').slice(0, 12);
  return path.join(INDEX_CACHE_DIR, `fish-index-${userId}-${rarity}-${hash}.png`);
}

async function buildFishGalleryImage(userId, rarity) {
  ensureCacheDir();
  const discoveredSet = new Set(getDiscoveredFish(userId));
  const filePath = galleryCachePath(userId, rarity, discoveredSet);
  if (fs.existsSync(filePath)) return new AttachmentBuilder(filePath, { name: 'fish-index.png' });

  const fishes = FISHES.filter((fish) => fish.rarity === rarity);
  const cols = 3;
  const cardW = 250;
  const cardH = 225;
  const gap = 22;
  const padding = 32;
  const titleH = 78;
  const rows = Math.max(1, Math.ceil(fishes.length / cols));
  const width = padding * 2 + (cols * cardW) + ((cols - 1) * gap);
  const height = titleH + padding + (rows * cardH) + ((rows - 1) * gap);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const color = RARITY_COLORS[rarity] || '#ffffff';

  ctx.fillStyle = '#111214';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${RARITY_LABELS[rarity] || rarity} Fish Index`, padding, 42);
  ctx.fillStyle = '#b5bac1';
  ctx.font = '16px sans-serif';
  ctx.fillText(`${fishes.length} fish in this rarity ✨`, padding, 66);

  for (let i = 0; i < fishes.length; i += 1) {
    const fish = fishes[i];
    const rowIndex = Math.floor(i / cols);
    const colIndex = i % cols;
    const x = padding + colIndex * (cardW + gap);
    const y = titleH + rowIndex * (cardH + gap);
    const discovered = discoveredSet.has(fish.id);

    roundedRect(ctx, x, y, cardW, cardH, 18);
    ctx.fillStyle = discovered ? '#1e1f22' : '#17181b';
    ctx.fill();
    ctx.strokeStyle = discovered ? color : '#34373d';
    ctx.lineWidth = discovered ? 3 : 2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = discovered ? color : '#7d838c';
    fitText(ctx, fish.name, cardW - 26, 22, 12);
    ctx.fillText(discovered ? fish.name : '???', x + cardW / 2, y + 32);

    const iconSize = 108;
    const iconX = x + (cardW - iconSize) / 2;
    const iconY = y + 58;
    roundedRect(ctx, iconX - 10, iconY - 10, iconSize + 20, iconSize + 20, 20);
    ctx.fillStyle = discovered ? '#2b2d31' : '#202226';
    ctx.fill();
    await drawFishIcon(ctx, fish, iconX, iconY, iconSize, discovered);

    const chance = formatChance(fish.chance);
    ctx.font = 'bold 17px sans-serif';
    const chanceW = ctx.measureText(chance).width + 18;
    const chanceX = x + cardW - chanceW - 14;
    const chanceY = y + cardH - 36;
    roundedRect(ctx, chanceX, chanceY, chanceW, 26, 10);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(chance, chanceX + 9, chanceY + 19);
  }

  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  return new AttachmentBuilder(filePath, { name: 'fish-index.png' });
}

async function buildFishPayload(interaction, rarity = 'common') {
  const safeRarity = RARITIES.includes(rarity) ? rarity : 'common';
  const discovered = getDiscoveredFish(interaction.user.id);
  const attachment = await buildFishGalleryImage(interaction.user.id, safeRarity);
  const rarityButtons = RARITIES.map((key) => button(`index:fish:${interaction.user.id}:${key}`, RARITY_LABELS[key] || key, key === safeRarity));
  return payload([
    text(`Welcome ${interaction.user} to Index!\n* Viewing **Fish Index**\n-# You have discovered ${discovered.length} / ${FISHES.length} so far.`),
    { type: 12, items: [{ media: { url: 'attachment://fish-index.png' } }] },
    separator(),
    row(...rarityButtons.slice(0, 3)),
    row(...rarityButtons.slice(3, 6)),
    categorySelect(interaction.user.id, 'fish'),
  ], [attachment]);
}

module.exports = {
  data: new SlashCommandBuilder().setName('index').setDescription('Open the collection index'),
  async execute(interaction) {
    await interaction.reply(buildHomePayload(interaction));
  },
  async handleInteraction(interaction) {
    if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith('index:category:')) {
      if (ownerFromId(interaction.customId) !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use your own index controls.', flags: EPHEMERAL_FLAG });
        return true;
      }
      if (interaction.values?.[0] === 'fish') {
        await interaction.deferUpdate();
        await interaction.editReply(await buildFishPayload(interaction, 'common'));
        return true;
      }
    }
    if (interaction.isButton?.() && interaction.customId?.startsWith('index:fish:')) {
      const parts = interaction.customId.split(':');
      if (parts[2] !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use your own index controls.', flags: EPHEMERAL_FLAG });
        return true;
      }
      await interaction.deferUpdate();
      await interaction.editReply(await buildFishPayload(interaction, parts[3]));
      return true;
    }
    return false;
  },
};
