const { AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const CANVAS_SIZE = 256;
const imageCache = new Map();

function getEmojiUrl(emoji) {
  const match = emoji?.match(/<:[^:]+:(\d+)>/);
  if (!match) {
    return null;
  }
  return `https://cdn.discordapp.com/emojis/${match[1]}.png?size=256&quality=lossless`;
}

async function loadCachedImage(url) {
  if (!url) {
    return null;
  }

  if (imageCache.has(url)) {
    return imageCache.get(url);
  }

  try {
    const image = await loadImage(url);
    imageCache.set(url, image);
    return image;
  } catch (error) {
    console.warn('Failed to load image for dig thumbnail:', url, error);
    return null;
  }
}

async function drawLayer(ctx, layerImageUrl, brightness = 1) {
  const layerImage = await loadCachedImage(getEmojiUrl(layerImageUrl) || layerImageUrl);
  if (!layerImage) {
    ctx.fillStyle = '#3b2f2f';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    return;
  }

  ctx.save();
  ctx.filter = `brightness(${brightness})`;
  ctx.drawImage(layerImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.restore();
}

function getItemImageUrl(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return item.image || getEmojiUrl(item.emoji);
}

async function drawLoot(ctx, items = []) {
  for (const item of items) {
    const url = getItemImageUrl(item);
    const image = await loadCachedImage(url);
    if (!image) {
      continue;
    }

    const scale = 0.25 + Math.random() * 0.15;
    const size = CANVAS_SIZE * scale;
    const x = Math.random() * (CANVAS_SIZE - size);
    const y = Math.random() * (CANVAS_SIZE - size);

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
  }
}

async function createDigThumbnail({ layerImageUrl, items = [], brightness = 1 } = {}) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext('2d');

  await drawLayer(ctx, layerImageUrl, brightness);
  await drawLoot(ctx, items);

  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'dig-thumbnail.png' });
}

module.exports = {
  createDigThumbnail,
};
