const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { INDEX_CANVAS_FONT_FAMILY, assertIndexCanvasFontAvailable } = require('../../../canvasFonts');
const { customEmojiImageUrl, SHECKLES_EMOJI } = require('../data/emojis');
const { RARITIES } = require('../data/seeds');
const { formatInteger } = require('../utils/format');
const { roundedRect } = require('./indexRenderer');

const SHOP_CARD_WIDTH = 592;
const SHOP_CARD_HEIGHT = 480;
const SHOP_PAGE_COLUMNS = 3;
const SHOP_PAGE_ROWS = 2;
const SHOP_PAGE_GAP = 24;
const SHOP_PAGE_PADDING = 48;
const SHOP_PAGE_WIDTH = 1_920;
const SHOP_PAGE_HEIGHT = 1_080;
const IMAGE_TIMEOUT_MS = 8_000;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const THEMES = Object.freeze({
  Common: ['#334155', '#111827'],
  Uncommon: ['#166534', '#052E16'],
  Rare: ['#1D4ED8', '#172554'],
  Epic: ['#7E22CE', '#2E1065'],
  Legendary: ['#B45309', '#451A03'],
  Mythic: ['#BE123C', '#4C0519'],
  Super: ['#0E7490', '#312E81'],
  Secret: ['#A16207', '#422006'],
});

async function fetchCanvasImage(source, fetchImpl = globalThis.fetch) {
  if (!/^https?:\/\//i.test(String(source || ''))) return loadImage(source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(source, { signal: controller.signal });
    if (!response.ok) throw new Error(`Shop image request failed with HTTP ${response.status}.`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) throw new Error('Shop image is too large.');
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > IMAGE_MAX_BYTES) throw new Error('Shop image has an invalid size.');
    return loadImage(body);
  } finally {
    clearTimeout(timer);
  }
}

function font(weight, size) {
  return `${weight} ${size}px "${INDEX_CANVAS_FONT_FAMILY}"`;
}

function fitText(context, value, maximumWidth, startSize = 37, minimumSize = 22) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '');
  let size = startSize;
  while (size > minimumSize) {
    context.font = font(700, size);
    if (context.measureText(text).width <= maximumWidth) return { text, size };
    size -= 1;
  }
  let shown = text;
  context.font = font(700, minimumSize);
  while (shown.length > 1 && context.measureText(`${shown}…`).width > maximumWidth) shown = shown.slice(0, -1);
  return { text: `${shown}…`, size: minimumSize };
}

function pageCardPositions(countValue) {
  const count = Math.max(0, Math.min(SHOP_PAGE_COLUMNS * SHOP_PAGE_ROWS, Math.floor(Number(countValue) || 0)));
  if (!count) return [];
  const rows = count <= SHOP_PAGE_COLUMNS ? [count] : [SHOP_PAGE_COLUMNS, count - SHOP_PAGE_COLUMNS];
  const usedHeight = (rows.length * SHOP_CARD_HEIGHT) + ((rows.length - 1) * SHOP_PAGE_GAP);
  const startY = Math.floor((SHOP_PAGE_HEIGHT - usedHeight) / 2);
  const positions = [];
  rows.forEach((rowCount, row) => {
    const usedWidth = (rowCount * SHOP_CARD_WIDTH) + ((rowCount - 1) * SHOP_PAGE_GAP);
    const startX = Math.floor((SHOP_PAGE_WIDTH - usedWidth) / 2);
    for (let column = 0; column < rowCount; column += 1) {
      positions.push(Object.freeze({
        x: startX + (column * (SHOP_CARD_WIDTH + SHOP_PAGE_GAP)),
        y: startY + (row * (SHOP_CARD_HEIGHT + SHOP_PAGE_GAP)),
      }));
    }
  });
  return positions;
}

class ShopPageRenderer {
  constructor(options = {}) {
    assertIndexCanvasFontAvailable();
    this.loadImage = options.loadImage || ((source) => fetchCanvasImage(source, options.fetchImpl));
    this.maxCacheEntries = Math.max(6, Number(options.maxCacheEntries) || 96);
    this.imageCache = new Map();
    this.renderCache = new Map();
  }

  cachedImage(key, source) {
    if (!this.imageCache.has(key)) {
      this.imageCache.set(key, Promise.resolve()
        .then(() => this.loadImage(source))
        .catch(() => null));
    }
    return this.imageCache.get(key);
  }

  drawFallback(context, item) {
    const centerX = 144;
    const centerY = 257;
    const gradient = context.createRadialGradient(centerX - 16, centerY - 20, 4, centerX, centerY, 92);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(1, 'rgba(255,255,255,0.16)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(centerX, centerY, 90, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#111827';
    context.textAlign = 'center';
    context.font = font(700, 44);
    const initials = item.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2);
    context.fillText(initials, centerX, centerY + 15);
    context.textAlign = 'left';
  }

  async renderCard(item) {
    const canvas = createCanvas(SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT);
    const context = canvas.getContext('2d');
    const [start, end] = THEMES[item.rarity] || THEMES.Common;
    const background = context.createLinearGradient(0, 0, SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT);
    background.addColorStop(0, start);
    background.addColorStop(1, end);
    context.fillStyle = background;
    roundedRect(context, 0, 0, SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT, 28);
    context.fill();

    context.save();
    roundedRect(context, 0, 0, SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT, 28);
    context.clip();
    context.globalAlpha = 0.08;
    context.fillStyle = '#FFFFFF';
    for (let index = 0; index < 18; index += 1) {
      context.beginPath();
      context.arc(20 + ((index * 97) % 550), 20 + ((index * 71) % 440), 3 + (index % 8), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.fillStyle = 'rgba(3, 7, 18, 0.42)';
    roundedRect(context, 24, 108, 240, 334, 26);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.13)';
    context.lineWidth = 2;
    roundedRect(context, 25, 109, 238, 332, 25);
    context.stroke();

    const art = await this.cachedImage(`item:${item.id}`, customEmojiImageUrl(item.emoji));
    if (art) {
      const maximum = 202;
      const scale = Math.min(maximum / art.width, maximum / art.height);
      const width = art.width * scale;
      const height = art.height * scale;
      context.drawImage(art, 144 - (width / 2), 257 - (height / 2), width, height);
    } else {
      this.drawFallback(context, item);
    }

    const badgeColor = RARITIES[item.rarity]?.color || 0xFFFFFF;
    context.fillStyle = `#${badgeColor.toString(16).padStart(6, '0')}`;
    roundedRect(context, 50, 388, 188, 38, 19);
    context.fill();
    context.fillStyle = item.rarity === 'Secret' || item.rarity === 'Legendary' ? '#111827' : '#FFFFFF';
    context.textAlign = 'center';
    context.font = font(700, 18);
    context.fillText(item.rarity.toUpperCase(), 144, 413);
    context.textAlign = 'left';

    const fitted = fitText(context, item.displayName, 536, 36, 22);
    context.fillStyle = '#FFFFFF';
    context.font = font(700, fitted.size);
    context.fillText(fitted.text, 28, 52);

    context.fillStyle = 'rgba(255,255,255,0.72)';
    context.font = font(600, 21);
    context.fillText(item.type, 28, 84);

    context.fillStyle = 'rgba(3,7,18,0.42)';
    roundedRect(context, 286, 124, 282, 126, 22);
    context.fill();
    const sheckles = await this.cachedImage('sheckles', customEmojiImageUrl(SHECKLES_EMOJI));
    if (sheckles) context.drawImage(sheckles, 310, 162, 48, 48);
    context.fillStyle = '#FFFFFF';
    const priceText = formatInteger(item.price);
    let priceSize = 32;
    const priceX = sheckles ? 370 : 310;
    while (priceSize > 18) {
      context.font = font(700, priceSize);
      if (context.measureText(priceText).width <= 568 - priceX - 16) break;
      priceSize -= 1;
    }
    context.font = font(700, priceSize);
    context.fillText(priceText, priceX, 198);

    const out = BigInt(item.stockRemaining) <= 0n;
    context.fillStyle = out ? '#EF4444' : '#22C55E';
    roundedRect(context, 286, 282, 282, 112, 22);
    context.fill();
    context.fillStyle = '#FFFFFF';
    context.textAlign = 'center';
    context.font = font(700, out ? 25 : 31);
    context.fillText(out ? 'OUT OF STOCK' : `Stock: x${item.stockRemaining}`, 427, 351);
    context.textAlign = 'left';
    return canvas;
  }

  async renderUncached(items) {
    const canvas = createCanvas(SHOP_PAGE_WIDTH, SHOP_PAGE_HEIGHT);
    const context = canvas.getContext('2d');
    context.fillStyle = '#080B14';
    context.fillRect(0, 0, SHOP_PAGE_WIDTH, SHOP_PAGE_HEIGHT);
    const cards = await Promise.all(items.map((item) => this.renderCard(item)));
    const positions = pageCardPositions(items.length);
    cards.forEach((card, index) => {
      const position = positions[index];
      context.drawImage(card, position.x, position.y, SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT);
    });
    return canvas.toBuffer('image/png');
  }

  render(items, options = {}) {
    if (!Array.isArray(items) || items.length < 1 || items.length > SHOP_PAGE_COLUMNS * SHOP_PAGE_ROWS) {
      throw new RangeError('A Shop composite page must contain between one and six items.');
    }
    const key = JSON.stringify({
      restockEpoch: Number(options.restockEpoch),
      page: Number(options.page),
      catalogueVersion: Number(options.catalogueVersion),
      items: items.map((item) => ({
        id: item.id,
        configVersion: item.configVersion,
        price: String(item.price),
        stock: String(item.stockRemaining),
      })),
    });
    if (!this.renderCache.has(key)) {
      this.renderCache.set(key, this.renderUncached(items).catch((error) => {
        this.renderCache.delete(key);
        throw error;
      }));
      while (this.renderCache.size > this.maxCacheEntries) {
        this.renderCache.delete(this.renderCache.keys().next().value);
      }
    }
    return this.renderCache.get(key);
  }

  clear() {
    this.renderCache.clear();
    this.imageCache.clear();
  }
}

module.exports = {
  SHOP_CARD_HEIGHT,
  SHOP_CARD_WIDTH,
  SHOP_PAGE_HEIGHT,
  SHOP_PAGE_COLUMNS,
  SHOP_PAGE_ROWS,
  SHOP_PAGE_WIDTH,
  ShopPageRenderer,
  THEMES,
  fetchCanvasImage,
  pageCardPositions,
};
