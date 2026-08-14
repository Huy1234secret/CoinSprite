const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { INDEX_CANVAS_FONT_FAMILY, assertIndexCanvasFontAvailable } = require('../../../canvasFonts');
const { customEmojiImageUrl, SHECKLES_EMOJI } = require('../data/emojis');
const { RARITIES } = require('../data/seeds');
const { formatInteger } = require('../utils/format');
const { roundedRect } = require('./indexRenderer');

const SHOP_CARD_WIDTH = 420;
const SHOP_CARD_HEIGHT = 420;
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

class ShopCardRenderer {
  constructor(options = {}) {
    assertIndexCanvasFontAvailable();
    this.loadImage = options.loadImage || ((source) => fetchCanvasImage(source, options.fetchImpl));
    this.maxCacheEntries = Math.max(24, Number(options.maxCacheEntries) || 256);
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
    const centerX = 110;
    const centerY = 215;
    const gradient = context.createRadialGradient(centerX - 12, centerY - 16, 4, centerX, centerY, 68);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(1, 'rgba(255,255,255,0.16)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(centerX, centerY, 66, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#111827';
    context.textAlign = 'center';
    context.font = font(700, 36);
    const initials = item.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2);
    context.fillText(initials, centerX, centerY + 12);
    context.textAlign = 'left';
  }

  async renderUncached(item) {
    const canvas = createCanvas(SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT);
    const context = canvas.getContext('2d');
    const [start, end] = THEMES[item.rarity] || THEMES.Common;
    const background = context.createLinearGradient(0, 0, SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT);
    background.addColorStop(0, start);
    background.addColorStop(1, end);
    context.fillStyle = background;
    context.fillRect(0, 0, SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT);

    context.save();
    context.globalAlpha = 0.08;
    context.fillStyle = '#FFFFFF';
    for (let index = 0; index < 18; index += 1) {
      context.beginPath();
      context.arc(20 + ((index * 71) % 390), 20 + ((index * 61) % 390), 3 + (index % 8), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.fillStyle = 'rgba(3, 7, 18, 0.42)';
    roundedRect(context, 22, 102, 176, 282, 26);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.13)';
    context.lineWidth = 2;
    roundedRect(context, 23, 103, 174, 280, 25);
    context.stroke();

    const art = await this.cachedImage(`item:${item.id}`, customEmojiImageUrl(item.emoji));
    if (art) {
      const maximum = 148;
      const scale = Math.min(maximum / art.width, maximum / art.height);
      const width = art.width * scale;
      const height = art.height * scale;
      context.drawImage(art, 110 - (width / 2), 215 - (height / 2), width, height);
    } else {
      this.drawFallback(context, item);
    }

    const badgeColor = RARITIES[item.rarity]?.color || 0xFFFFFF;
    context.fillStyle = `#${badgeColor.toString(16).padStart(6, '0')}`;
    roundedRect(context, 36, 330, 148, 36, 18);
    context.fill();
    context.fillStyle = item.rarity === 'Secret' || item.rarity === 'Legendary' ? '#111827' : '#FFFFFF';
    context.textAlign = 'center';
    context.font = font(700, 16);
    context.fillText(item.rarity.toUpperCase(), 110, 354);
    context.textAlign = 'left';

    const fitted = fitText(context, item.displayName, 376, 32, 20);
    context.fillStyle = '#FFFFFF';
    context.font = font(700, fitted.size);
    context.fillText(fitted.text, 22, 48);

    context.fillStyle = 'rgba(255,255,255,0.72)';
    context.font = font(600, 18);
    context.fillText(item.type, 22, 78);

    context.fillStyle = 'rgba(3,7,18,0.42)';
    roundedRect(context, 216, 112, 182, 90, 20);
    context.fill();
    const sheckles = await this.cachedImage('sheckles', customEmojiImageUrl(SHECKLES_EMOJI));
    if (sheckles) context.drawImage(sheckles, 234, 138, 38, 38);
    context.fillStyle = '#FFFFFF';
    context.font = font(700, 25);
    context.fillText(formatInteger(item.price), sheckles ? 282 : 234, 169);

    const out = BigInt(item.stockRemaining) <= 0n;
    context.fillStyle = out ? '#EF4444' : '#22C55E';
    roundedRect(context, 216, 230, 182, 80, 20);
    context.fill();
    context.fillStyle = '#FFFFFF';
    context.textAlign = 'center';
    context.font = font(700, out ? 20 : 24);
    context.fillText(out ? 'OUT OF STOCK' : `Stock: x${item.stockRemaining}`, 307, 280);
    context.textAlign = 'left';
    return canvas.toBuffer('image/png');
  }

  render(item, restockEpoch) {
    const key = `${item.id}:${restockEpoch}:${item.price}:${item.stockRemaining}`;
    if (!this.renderCache.has(key)) {
      this.renderCache.set(key, this.renderUncached(item).catch((error) => {
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

module.exports = { SHOP_CARD_HEIGHT, SHOP_CARD_WIDTH, ShopCardRenderer, THEMES, fetchCanvasImage };
