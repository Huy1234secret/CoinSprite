const { createCanvas, loadImage } = require('@napi-rs/canvas');

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const PADDING = 20;
const COLS = 3;
const BACKGROUND_COLOR = '#2f3136';
const CARD_BG_COLOR = '#202225';
const TEXT_COLOR = '#ffffff';

const DISCORD_EMOJIS = {
  currency: '1447459216574124074',
  rarity: {
    common: '1447459423185272952',
    rare: '1447459432165408789',
    epic: '1447459425303527465',
    legendary: '1447459428273098835',
    mythical: '1447459430760317172',
    secret: '1447459434677665874'
  }
};

const ITEM_PLACEHOLDER_EMOJI = '<:ITPlaceholder:1447469370421940304>';

const RARITY_COLORS = {
  common: '#95a5a6',
  rare: '#3498db',
  epic: '#9b59b6',
  legendary: '#f1c40f',
  mythical: '#e74c3c',
  secret: '#000000'
};

const getEmojiUrl = (id) => `https://cdn.discordapp.com/emojis/${id}.png`;

async function ensureShopAssets() {
  return {
    currencyIcon: DISCORD_EMOJIS.currency,
    rarities: DISCORD_EMOJIS.rarity
  };
}

function getPlaceholderItems({ rarities } = { rarities: DISCORD_EMOJIS.rarity }) {
  return [
    { name: 'Steel Sword', price: 150, stock: 5, rarity: 'common', image: null, emoji: null },
    { name: 'Golden Apple', price: 50, stock: 99, rarity: 'rare', image: null, emoji: null },
    { name: 'Dragon Egg', price: 5000, stock: 1, rarity: 'legendary', image: null, emoji: null },
    { name: 'Health Potion', price: 25, stock: 15, rarity: 'common', image: null, emoji: null },
    { name: 'Magic Wand', price: 1200, stock: 3, rarity: 'epic', image: null, emoji: null },
    { name: 'Ancient Shield', price: 850, stock: 2, rarity: 'mythical', image: null, emoji: null }
  ];
}

async function createShopImage(items = getPlaceholderItems(), currencyIconId = DISCORD_EMOJIS.currency) {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  const cardWidth = (CANVAS_WIDTH - (PADDING * (COLS + 1))) / COLS;
  const rows = Math.ceil(items.length / COLS) || 1;
  const cardHeight = (CANVAS_HEIGHT - (PADDING * (rows + 1))) / rows;

  const currencyIcon = await loadImageSafe(resolveEmojiSource(currencyIconId));
  const placeholderItemImage = await loadImageSafe(resolveEmojiSource(ITEM_PLACEHOLDER_EMOJI));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const colIndex = i % COLS;
    const rowIndex = Math.floor(i / COLS);

    const x = PADDING + (colIndex * (cardWidth + PADDING));
    const y = PADDING + (rowIndex * (cardHeight + PADDING));

    await drawCard(ctx, x, y, cardWidth, cardHeight, item, currencyIcon, placeholderItemImage);
  }

  return canvas.toBuffer('image/png');
}

async function drawCard(ctx, x, y, w, h, item, currencyIcon, placeholderItemImage) {
  const radius = 15;
  const rarityColor = RARITY_COLORS[item.rarity] || '#ffffff';

  ctx.save();
  roundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = CARD_BG_COLOR;
  ctx.fill();
  ctx.strokeStyle = rarityColor;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  const imgSize = 120;
  const imgX = x + (w / 2) - (imgSize / 2);
  const imgY = y + 25;

  let itemImage = null;

  if (item.image) {
    itemImage = await loadImageSafe(item.image);
  }

  if (!itemImage) {
    itemImage = placeholderItemImage;
  }

  if (itemImage) {
    drawImageWithinBounds(ctx, itemImage, imgX, imgY, imgSize);
  } else {
    drawPlaceholderImage(ctx, imgX, imgY, imgSize, rarityColor);
  }

  ctx.textAlign = 'center';

  ctx.font = 'bold 26px Sans-Serif';
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(item.name, x + (w / 2), y + 190);

  const rarityEmojiId = DISCORD_EMOJIS.rarity[item.rarity] || DISCORD_EMOJIS.rarity.common;
  const rarityY = y + 210;

  try {
    const rarityImg = await loadImageSafe(resolveEmojiSource(rarityEmojiId));
    const rarityText = item.rarity.toUpperCase();
    ctx.font = 'italic 18px Sans-Serif';
    const textWidth = ctx.measureText(rarityText).width;
    const rarityScale = 64 / Math.max(rarityImg.width, rarityImg.height);
    const rarityWidth = rarityImg.width * rarityScale;
    const rarityHeight = rarityImg.height * rarityScale;
    const totalWidth = rarityWidth + 5 + textWidth;
    const startX = x + (w / 2) - (totalWidth / 2);

    ctx.drawImage(rarityImg, startX, rarityY, rarityWidth, rarityHeight);

    ctx.fillStyle = rarityColor;
    ctx.textAlign = 'left';
    ctx.fillText(rarityText, startX + rarityWidth + 5, rarityY + 22);
  } catch (error) {
    ctx.textAlign = 'center';
    ctx.fillStyle = rarityColor;
    ctx.fillText(item.rarity.toUpperCase(), x + (w / 2), y + 200);
  }

  const priceY = y + 270;
  const iconSize = 56;
  ctx.font = 'bold 24px Sans-Serif';
  ctx.textAlign = 'center';

  const priceText = `${item.price}`;
  const priceWidth = ctx.measureText(priceText).width;

  const fullPriceWidth = priceWidth + 10 + iconSize;
  const priceStartX = x + (w / 2) - (fullPriceWidth / 2);

  ctx.fillStyle = '#f1c40f';
  ctx.textAlign = 'left';
  ctx.fillText(priceText, priceStartX, priceY + 22);

  if (currencyIcon) {
    ctx.drawImage(currencyIcon, priceStartX + priceWidth + 10, priceY, iconSize, iconSize);
  } else {
    ctx.fillText('Gold', priceStartX + priceWidth + 10, priceY + 22);
  }

  ctx.textAlign = 'center';
  ctx.font = '20px Sans-Serif';
  ctx.fillStyle = '#95a5a6';
  ctx.fillText(`Stock: ${item.stock}`, x + (w / 2), y + 330);
}

function resolveEmojiSource(source) {
  if (!source) {
    return null;
  }

  if (/^https?:\/\//.test(source)) {
    return source;
  }

  if (/^\d+$/.test(source)) {
    return getEmojiUrl(source);
  }

  const customEmojiMatch = /<:\w+:(\d+)>/.exec(source);
  if (customEmojiMatch) {
    return getEmojiUrl(customEmojiMatch[1]);
  }

  return source;
}

async function loadImageSafe(source) {
  if (!source) {
    return null;
  }

  try {
    return await loadImage(source);
  } catch (error) {
    console.warn(`Failed to load image from ${source}:`, error);
    return null;
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawPlaceholderImage(ctx, x, y, size, color) {
  ctx.save();
  ctx.fillStyle = '#2c2f33';
  ctx.fillRect(x, y, size, size);

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = 'bold 16px Sans-Serif';
  ctx.textAlign = 'center';
  ctx.fillText('ITEM', x + size / 2, y + size / 2 + 5);
  ctx.restore();
}

function drawImageWithinBounds(ctx, image, x, y, size) {
  const scale = Math.min(size / image.width, size / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = x + ((size - drawWidth) / 2);
  const offsetY = y + ((size - drawHeight) / 2);

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

module.exports = {
  ensureShopAssets,
  createShopImage,
  getPlaceholderItems,
  ITEM_PLACEHOLDER_EMOJI
};
