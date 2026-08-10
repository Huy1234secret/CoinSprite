const crypto = require('crypto');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { assertCanvasFontsAvailable } = require('../../../canvasFonts');
const { customEmojiImageUrl, SHECKLES_EMOJI } = require('../data/emojis');
const { SEEDS } = require('../data/seeds');
const { formatChance, formatInteger } = require('../utils/format');

const INDEX_PAGE_SIZE = 6;
const INDEX_COLUMNS = 3;
const INDEX_ROWS = 2;
const INDEX_MAX_PAGE = Math.ceil(SEEDS.length / INDEX_PAGE_SIZE);
const STUDS_TEXTURE_PATH = path.join(__dirname, '..', 'assets', 'studs-texture.png');
const OUTLINE_COLORS = Object.freeze({
  Common: '#FFFFFF',
  Uncommon: '#86EFAC',
  Rare: '#0891B2',
  Epic: '#F472B6',
  Legendary: '#FACC15',
  Mythic: '#EF4444',
});

function discoveryHash(discoveredSeedIds) {
  return crypto.createHash('sha256').update([...discoveredSeedIds].sort().join('\0')).digest('hex').slice(0, 20);
}

function indexPageModels(discoveredSeedIds, page) {
  const discovered = new Set(discoveredSeedIds || []);
  const currentPage = Math.max(1, Math.min(INDEX_MAX_PAGE, Math.floor(Number(page) || 1)));
  return SEEDS.slice((currentPage - 1) * INDEX_PAGE_SIZE, currentPage * INDEX_PAGE_SIZE).map((seed) => ({
    seed,
    discovered: discovered.has(seed.id),
    displayName: discovered.has(seed.id) ? seed.displayName : '???',
    chance: discovered.has(seed.id) ? formatChance(seed) : '',
    averageValue: discovered.has(seed.id)
      ? (BigInt(seed.minimumValue) + BigInt(seed.maximumValue)) / 2n
      : null,
  }));
}

function cropImageUrl(seed) {
  return customEmojiImageUrl(seed.emoji);
}

class CropIndexRenderer {
  constructor(options = {}) {
    assertCanvasFontsAvailable();
    this.loadImage = options.loadImage || loadImage;
    this.studsPath = options.studsPath || STUDS_TEXTURE_PATH;
    this.imageCache = new Map();
    this.renderCache = new Map();
    this.rainbowBorder = null;
  }

  cachedImage(key, source) {
    if (!this.imageCache.has(key)) {
      this.imageCache.set(key, Promise.resolve(this.loadImage(source)).catch(() => null));
    }
    return this.imageCache.get(key);
  }

  rainbowBorderFor(width, height) {
    if (this.rainbowBorder) return this.rainbowBorder;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, width, height);
    ['#FF0000', '#FF8A00', '#FFF200', '#22C55E', '#00E5FF', '#3B82F6', '#A855F7', '#FF0000']
      .forEach((color, index, colors) => gradient.addColorStop(index / (colors.length - 1), color));
    context.strokeStyle = gradient;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, width - 1, height - 1);
    this.rainbowBorder = canvas;
    return canvas;
  }

  async drawCrop(context, model, x, y, width, height) {
    const image = await this.cachedImage(`crop:${model.seed.id}`, cropImageUrl(model.seed));
    if (!image) return;
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = x + ((width - drawWidth) / 2);
    const drawY = y + ((height - drawHeight) / 2);
    if (model.discovered) {
      context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
      return;
    }
    const mask = createCanvas(Math.ceil(drawWidth), Math.ceil(drawHeight));
    const maskContext = mask.getContext('2d');
    maskContext.drawImage(image, 0, 0, drawWidth, drawHeight);
    maskContext.globalCompositeOperation = 'source-in';
    maskContext.fillStyle = '#000000';
    maskContext.fillRect(0, 0, drawWidth, drawHeight);
    context.drawImage(mask, drawX, drawY);
  }

  async renderUncached(models) {
    const width = 1200;
    const height = 700;
    const padding = 34;
    const gap = 22;
    const cardWidth = Math.floor((width - (padding * 2) - (gap * (INDEX_COLUMNS - 1))) / INDEX_COLUMNS);
    const cardHeight = Math.floor((height - (padding * 2) - (gap * (INDEX_ROWS - 1))) / INDEX_ROWS);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#101114';
    context.fillRect(0, 0, width, height);

    const studs = await this.cachedImage('studs', this.studsPath);
    if (studs) {
      context.save();
      context.globalAlpha = 0.055;
      for (let x = 0; x < width; x += studs.width) {
        for (let y = 0; y < height; y += studs.height) context.drawImage(studs, x, y);
      }
      context.restore();
    }
    const sheckles = await this.cachedImage('sheckles', customEmojiImageUrl(SHECKLES_EMOJI));

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      const column = index % INDEX_COLUMNS;
      const row = Math.floor(index / INDEX_COLUMNS);
      const x = padding + (column * (cardWidth + gap));
      const y = padding + (row * (cardHeight + gap));
      context.fillStyle = 'rgba(12, 13, 16, 0.92)';
      context.fillRect(x, y, cardWidth, cardHeight);
      if (model.seed.rarity === 'Super') {
        context.drawImage(this.rainbowBorderFor(cardWidth, cardHeight), x, y);
      } else {
        context.strokeStyle = OUTLINE_COLORS[model.seed.rarity] || '#FFFFFF';
        context.lineWidth = 1;
        context.strokeRect(x + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1);
      }
      await this.drawCrop(context, model, x + 42, y + 18, cardWidth - 84, cardHeight - 105);
      context.fillStyle = '#FFFFFF';
      context.textAlign = 'left';
      context.font = '700 27px "Noto Sans Variable"';
      context.fillText(model.displayName, x + 22, y + cardHeight - 54, cardWidth - 44);
      if (!model.discovered) continue;
      context.fillStyle = '#B8BBC4';
      context.font = '500 18px "Noto Sans Variable"';
      context.fillText(model.chance, x + 22, y + cardHeight - 24, cardWidth / 2);
      const valueText = `~${formatInteger(model.averageValue)}`;
      context.textAlign = 'right';
      context.fillStyle = '#FFFFFF';
      context.font = '600 18px "Noto Sans Variable"';
      const iconSize = 22;
      const textWidth = context.measureText(valueText).width;
      const right = x + cardWidth - 20;
      if (sheckles) context.drawImage(sheckles, right - textWidth - iconSize - 7, y + cardHeight - 43, iconSize, iconSize);
      context.fillText(valueText, right, y + cardHeight - 24);
    }
    return canvas.toBuffer('image/png');
  }

  async render(userId, discoveredSeedIds, page) {
    const discovered = new Set(discoveredSeedIds || []);
    const currentPage = Math.max(1, Math.min(INDEX_MAX_PAGE, Math.floor(Number(page) || 1)));
    const key = `${userId}:${currentPage}:${discoveryHash(discovered)}`;
    if (!this.renderCache.has(key)) {
      this.renderCache.set(key, this.renderUncached(indexPageModels(discovered, currentPage)).catch((error) => {
        this.renderCache.delete(key);
        throw error;
      }));
    }
    return this.renderCache.get(key);
  }

  invalidate(userId) {
    const prefix = `${userId}:`;
    for (const key of this.renderCache.keys()) if (key.startsWith(prefix)) this.renderCache.delete(key);
  }

  clear() {
    this.renderCache.clear();
    this.imageCache.clear();
  }
}

module.exports = {
  INDEX_COLUMNS,
  INDEX_MAX_PAGE,
  INDEX_PAGE_SIZE,
  INDEX_ROWS,
  OUTLINE_COLORS,
  STUDS_TEXTURE_PATH,
  CropIndexRenderer,
  discoveryHash,
  indexPageModels,
};
