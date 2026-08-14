const crypto = require('crypto');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  INDEX_CANVAS_FONT_FAMILY,
  assertIndexCanvasFontAvailable,
} = require('../../../canvasFonts');
const { customEmojiImageUrl, SHECKLES_EMOJI } = require('../data/emojis');
const { SEEDS, SEED_BY_ID } = require('../data/seeds');
const { formatChance, formatInteger } = require('../utils/format');

const INDEX_PAGE_SIZE = 6;
const INDEX_COLUMNS = 3;
const INDEX_ROWS = 2;
const INDEX_MAX_PAGE = Math.ceil(SEEDS.length / INDEX_PAGE_SIZE);
const INDEX_CANVAS_WIDTH = 1200;
const INDEX_CANVAS_HEIGHT = 800;
const INDEX_CARD_SIZE = 360;
const INDEX_CARD_RADIUS = 24;
const INDEX_CARD_GAP = 20;
const INDEX_PADDING_X = 40;
const INDEX_PADDING_Y = 30;
const STUDS_TILE_SIZE = 176;
const INDEX_IMAGE_TIMEOUT_MS = 8_000;
const INDEX_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const STUDS_TEXTURE_PATH = path.join(__dirname, '..', 'assets', 'studs-texture.png');
const OUTLINE_COLORS = Object.freeze({
  Common: '#FFFFFF',
  Uncommon: '#86EFAC',
  Rare: '#0891B2',
  Epic: '#F472B6',
  Legendary: '#FACC15',
  Mythic: '#EF4444',
});
const SECRET_OUTLINE_COLORS = Object.freeze(['#000000', '#FFFFFF']);

function discoveryHash(discoveredSeedIds) {
  return crypto.createHash('sha256').update([...discoveredSeedIds].sort().join('\0')).digest('hex').slice(0, 20);
}

function indexDiscoveryCount(discoveredSeedIds) {
  return [...new Set(discoveredSeedIds || [])].filter((seedId) => SEED_BY_ID.has(seedId)).length;
}

function indexSeedsForUser(discoveredSeedIds) {
  const discovered = new Set(discoveredSeedIds || []);
  return SEEDS.filter((seed) => !seed.secretUntilDiscovered || discovered.has(seed.id));
}

function indexPageModels(discoveredSeedIds, page) {
  const discovered = new Set(discoveredSeedIds || []);
  const currentPage = Math.max(1, Math.min(INDEX_MAX_PAGE, Math.floor(Number(page) || 1)));
  return indexSeedsForUser(discovered).slice(
    (currentPage - 1) * INDEX_PAGE_SIZE,
    currentPage * INDEX_PAGE_SIZE,
  ).map((seed) => ({
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
  return /^<a?:[a-z0-9_]+:\d{16,20}>$/i.test(String(seed.emoji || ''))
    ? customEmojiImageUrl(seed.emoji)
    : null;
}

async function loadIndexImage(source, options = {}) {
  if (!/^https?:\/\//i.test(String(source || ''))) return loadImage(source);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || INDEX_IMAGE_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(source, { signal: controller.signal });
    if (!response.ok) throw new Error(`Index image request failed with HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > INDEX_IMAGE_MAX_BYTES) {
      throw new Error('Index image exceeds the maximum supported size.');
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > INDEX_IMAGE_MAX_BYTES) throw new Error('Index image has an invalid size.');
    return loadImage(body);
  } finally {
    clearTimeout(timeout);
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const normalizedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + normalizedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, normalizedRadius);
  context.arcTo(x + width, y + height, x, y + height, normalizedRadius);
  context.arcTo(x, y + height, x, y, normalizedRadius);
  context.arcTo(x, y, x + width, y, normalizedRadius);
  context.closePath();
}

function indexFont(weight, size) {
  return `${weight} ${size}px "${INDEX_CANVAS_FONT_FAMILY}"`;
}

function fitIndexText(context, value, maximumWidth, options = {}) {
  const text = String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '');
  const minimum = Math.max(12, Number(options.minimum) || 18);
  let size = Math.max(minimum, Number(options.size) || 27);
  const weight = Number(options.weight) || 700;
  while (size > minimum) {
    context.font = indexFont(weight, size);
    if (context.measureText(text).width <= maximumWidth) return { text, size };
    size -= 1;
  }
  context.font = indexFont(weight, size);
  if (context.measureText(text).width <= maximumWidth) return { text, size };
  const characters = Array.from(text);
  while (characters.length > 1 && context.measureText(`${characters.join('')}\u2026`).width > maximumWidth) {
    characters.pop();
  }
  return { text: `${characters.join('')}\u2026`, size };
}

class CropIndexRenderer {
  constructor(options = {}) {
    assertIndexCanvasFontAvailable();
    this.loadImage = options.loadImage || ((source) => loadIndexImage(source, { fetchImpl: options.fetchImpl }));
    this.studsPath = options.studsPath || STUDS_TEXTURE_PATH;
    this.imageCache = new Map();
    this.renderCache = new Map();
    this.rainbowBorder = null;
    this.secretBorder = null;
    this.studsTile = null;
  }

  cachedImage(key, source) {
    if (!this.imageCache.has(key)) {
      this.imageCache.set(key, source
        ? Promise.resolve().then(() => this.loadImage(source)).catch(() => null)
        : Promise.resolve(null));
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
    context.lineWidth = 2;
    roundedRect(context, 1, 1, width - 2, height - 2, INDEX_CARD_RADIUS);
    context.stroke();
    this.rainbowBorder = canvas;
    return canvas;
  }

  secretBorderFor(width, height) {
    if (this.secretBorder) return this.secretBorder;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, width, height);
    SECRET_OUTLINE_COLORS.forEach((color, index, colors) => {
      gradient.addColorStop(index / (colors.length - 1), color);
    });
    context.strokeStyle = gradient;
    context.lineWidth = 2;
    roundedRect(context, 1, 1, width - 2, height - 2, INDEX_CARD_RADIUS);
    context.stroke();
    this.secretBorder = canvas;
    return canvas;
  }

  studsTileFor(image) {
    if (this.studsTile) return this.studsTile;
    const tile = createCanvas(STUDS_TILE_SIZE, STUDS_TILE_SIZE);
    const context = tile.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.drawImage(image, 0, 0, STUDS_TILE_SIZE, STUDS_TILE_SIZE);
    this.studsTile = tile;
    return tile;
  }

  drawFallbackCrop(context, model, x, y, width, height) {
    const color = model.discovered ? '#F43F5E' : '#000000';
    const leaf = model.discovered ? '#22C55E' : '#000000';
    const centerX = x + (width / 2);
    const centerY = y + (height * 0.46);
    const petalRadius = Math.min(width, height) * 0.16;
    context.save();
    context.fillStyle = leaf;
    context.lineWidth = Math.max(7, width * 0.045);
    context.strokeStyle = leaf;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(centerX, centerY + petalRadius * 0.8);
    context.quadraticCurveTo(centerX - width * 0.03, y + height * 0.72, centerX, y + height * 0.86);
    context.stroke();
    context.beginPath();
    context.ellipse(centerX + width * 0.09, y + height * 0.72, width * 0.12, height * 0.055, -0.45, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = color;
    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI * 2 * index) / 6;
      context.beginPath();
      context.ellipse(
        centerX + Math.cos(angle) * petalRadius,
        centerY + Math.sin(angle) * petalRadius,
        petalRadius * 0.9,
        petalRadius * 0.62,
        angle,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.beginPath();
    context.arc(centerX, centerY, petalRadius * 0.72, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  async drawCrop(context, model, x, y, width, height) {
    const image = await this.cachedImage(`crop:${model.seed.id}`, cropImageUrl(model.seed));
    if (!image) {
      this.drawFallbackCrop(context, model, x, y, width, height);
      return;
    }
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
    const width = INDEX_CANVAS_WIDTH;
    const height = INDEX_CANVAS_HEIGHT;
    const cardWidth = INDEX_CARD_SIZE;
    const cardHeight = INDEX_CARD_SIZE;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#0E1117';
    context.fillRect(0, 0, width, height);

    const studs = await this.cachedImage('studs', this.studsPath);
    let studsTile = null;
    if (studs) {
      studsTile = this.studsTileFor(studs);
      context.save();
      context.globalAlpha = 0.035;
      for (let x = -STUDS_TILE_SIZE / 2; x < width; x += STUDS_TILE_SIZE) {
        for (let y = -STUDS_TILE_SIZE / 2; y < height; y += STUDS_TILE_SIZE) {
          context.drawImage(studsTile, x, y);
        }
      }
      context.restore();
    }
    const sheckles = await this.cachedImage('sheckles', customEmojiImageUrl(SHECKLES_EMOJI));
    await Promise.all(models.map((model) => this.cachedImage(
      `crop:${model.seed.id}`,
      cropImageUrl(model.seed),
    )));

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      const column = index % INDEX_COLUMNS;
      const row = Math.floor(index / INDEX_COLUMNS);
      const x = INDEX_PADDING_X + (column * (cardWidth + INDEX_CARD_GAP));
      const y = INDEX_PADDING_Y + (row * (cardHeight + INDEX_CARD_GAP));
      context.fillStyle = '#12161D';
      roundedRect(context, x, y, cardWidth, cardHeight, INDEX_CARD_RADIUS);
      context.fill();
      if (studsTile) {
        context.save();
        roundedRect(context, x, y, cardWidth, cardHeight, INDEX_CARD_RADIUS);
        context.clip();
        context.beginPath();
        context.rect(x, y, cardWidth, 268);
        context.clip();
        context.globalAlpha = 0.035;
        for (let tileX = -STUDS_TILE_SIZE / 2; tileX < width; tileX += STUDS_TILE_SIZE) {
          for (let tileY = -STUDS_TILE_SIZE / 2; tileY < height; tileY += STUDS_TILE_SIZE) {
            context.drawImage(studsTile, tileX, tileY);
          }
        }
        context.restore();
      }
      if (model.seed.rarity === 'Super') {
        context.drawImage(this.rainbowBorderFor(cardWidth, cardHeight), x, y);
      } else if (model.seed.rarity === 'Secret') {
        context.drawImage(this.secretBorderFor(cardWidth, cardHeight), x, y);
      } else {
        context.strokeStyle = OUTLINE_COLORS[model.seed.rarity] || '#FFFFFF';
        context.lineWidth = 2;
        roundedRect(context, x + 1, y + 1, cardWidth - 2, cardHeight - 2, INDEX_CARD_RADIUS);
        context.stroke();
      }

      const imageStageSize = 232;
      const imageStageX = x + ((cardWidth - imageStageSize) / 2);
      const imageStageY = y + 18;
      context.fillStyle = 'rgba(5, 7, 11, 0.54)';
      roundedRect(context, imageStageX, imageStageY, imageStageSize, imageStageSize, 28);
      context.fill();
      context.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      context.lineWidth = 1;
      roundedRect(context, imageStageX + 0.5, imageStageY + 0.5, imageStageSize - 1, imageStageSize - 1, 28);
      context.stroke();
      context.save();
      roundedRect(context, imageStageX + 10, imageStageY + 10, imageStageSize - 20, imageStageSize - 20, 22);
      context.clip();
      await this.drawCrop(context, model, imageStageX + 22, imageStageY + 18, imageStageSize - 44, imageStageSize - 36);
      context.restore();

      context.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + 20, y + 268.5);
      context.lineTo(x + cardWidth - 20, y + 268.5);
      context.stroke();

      context.fillStyle = '#FFFFFF';
      context.textAlign = 'left';
      const fittedName = fitIndexText(context, model.displayName, cardWidth - 40, { size: 27, minimum: 19, weight: 700 });
      context.font = indexFont(700, fittedName.size);
      context.fillText(fittedName.text, x + 20, y + 305);
      if (!model.discovered) continue;
      context.fillStyle = '#B8BBC4';
      context.font = indexFont(500, 17);
      context.fillText(model.chance, x + 20, y + 337, cardWidth / 2);
      const valueText = `~${formatInteger(model.averageValue)}`;
      context.textAlign = 'right';
      context.fillStyle = '#FFFFFF';
      context.font = indexFont(600, 17);
      const iconSize = 20;
      const textWidth = context.measureText(valueText).width;
      const right = x + cardWidth - 20;
      if (sheckles) context.drawImage(sheckles, right - textWidth - iconSize - 7, y + 319, iconSize, iconSize);
      context.fillText(valueText, right, y + 337);
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
    this.rainbowBorder = null;
    this.secretBorder = null;
    this.studsTile = null;
  }
}

module.exports = {
  INDEX_CANVAS_HEIGHT,
  INDEX_CANVAS_WIDTH,
  INDEX_CARD_RADIUS,
  INDEX_CARD_SIZE,
  INDEX_COLUMNS,
  INDEX_MAX_PAGE,
  INDEX_PAGE_SIZE,
  INDEX_ROWS,
  OUTLINE_COLORS,
  SECRET_OUTLINE_COLORS,
  STUDS_TEXTURE_PATH,
  CropIndexRenderer,
  discoveryHash,
  fitIndexText,
  indexPageModels,
  indexDiscoveryCount,
  indexSeedsForUser,
  roundedRect,
};
