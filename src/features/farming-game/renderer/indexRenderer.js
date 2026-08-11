const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  INDEX_CANVAS_FONT_FAMILY,
  assertIndexCanvasFontAvailable,
} = require('../../../canvasFonts');
const { formatInteger } = require('../../shared/format');
const { formatCarrotWeight } = require('../utils/crops');
const { loadTrimmedImage } = require('./farmRenderer');

const INDEX_CANVAS_WIDTH = 1672;
const INDEX_CANVAS_HEIGHT = 941;
const INDEX_BACKGROUND_PATH = path.join(__dirname, '..', '..', '..', '..', 'images', 'icons', 'index.png');
const INDEX_IMAGE_BOXES = Object.freeze({
  seed: Object.freeze({ x: 280, y: 190, width: 428, height: 304 }),
  crop: Object.freeze({ x: 966, y: 190, width: 428, height: 304 }),
});
const INDEX_ROW_Y = Object.freeze([512, 572, 632, 692, 752]);
const INDEX_ROW_HEIGHT = 50;
const INDEX_ROW_WIDTH = 428;
const INDEX_ROW_X = Object.freeze({ seed: 280, crop: 966 });
const INDEX_ARTWORK_INSET = 20;
const INDEX_STAT_FONT_WEIGHT = 700;

function containDimensions(sourceWidth, sourceHeight, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function indexFont(weight, size) {
  return `${weight} ${size}px "${INDEX_CANVAS_FONT_FAMILY}"`;
}

function fitText(context, value, maximumWidth, size = 26, minimum = 14) {
  const original = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '');
  let fontSize = size;
  while (fontSize > minimum) {
    context.font = indexFont(INDEX_STAT_FONT_WEIGHT, fontSize);
    if (context.measureText(original).width <= maximumWidth) return { text: original, size: fontSize };
    fontSize -= 1;
  }
  context.font = indexFont(INDEX_STAT_FONT_WEIGHT, fontSize);
  const characters = [...original];
  while (characters.length > 1 && context.measureText(`${characters.join('')}…`).width > maximumWidth) characters.pop();
  return { text: `${characters.join('')}…`, size: fontSize };
}

function insetBox(box, inset = INDEX_ARTWORK_INSET) {
  const normalized = Math.max(0, Math.min(Number(inset) || 0, box.width / 2, box.height / 2));
  return {
    x: box.x + normalized,
    y: box.y + normalized,
    width: box.width - (normalized * 2),
    height: box.height - (normalized * 2),
  };
}

function silhouetteFor(image) {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = '#080a08';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function drawContained(context, image, box, silhouette = false) {
  const source = silhouette ? silhouetteFor(image) : image;
  const dimensions = containDimensions(image.width, image.height, box.width, box.height);
  const x = box.x + Math.round((box.width - dimensions.width) / 2);
  const y = box.y + Math.round((box.height - dimensions.height) / 2);
  context.drawImage(source, x, y, dimensions.width, dimensions.height);
}

function rowValues(entry) {
  if (entry.discovered === false) {
    return {
      seed: ['Name: ???', 'Rarity: ???', 'Value: ???', 'Grow Time: ???', 'Your Total Planted: ???'],
      crop: ['Name: ???', 'Rarity: ???', '~Value: ???', 'Your Highest Weight: ???', 'Total Harvested: ???'],
    };
  }
  const { seed, crop, statistics } = entry;
  const durationMinutes = Math.max(1, Math.round(entry.growTimeMs / 60_000));
  return {
    seed: [
      `Name: ${seed.name}`,
      `Rarity: ${seed.rarity}`,
      `Value: ${formatInteger(seed.value)} CR Coin`,
      `Grow Time: ${durationMinutes} minute${durationMinutes === 1 ? '' : 's'}`,
      `Your Total Planted: ${formatInteger(statistics.totalPlanted)}`,
    ],
    crop: [
      `Name: ${crop.name}`,
      `Rarity: ${crop.rarity}`,
      `~Value: ${formatInteger(crop.minimumValue)}–${formatInteger(crop.maximumValue)} CR Coin`,
      `Your Highest Weight: ${formatCarrotWeight(statistics.highestWeightUnits)} kg`,
      `Total Harvested: ${formatInteger(statistics.totalHarvested)}`,
    ],
  };
}

function drawRows(context, values, x) {
  context.fillStyle = '#53351d';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  values.forEach((value, index) => {
    const fitted = fitText(context, value, INDEX_ROW_WIDTH - 44);
    context.font = indexFont(INDEX_STAT_FONT_WEIGHT, fitted.size);
    context.fillText(fitted.text, x + 22, INDEX_ROW_Y[index] + (INDEX_ROW_HEIGHT / 2));
  });
}

function renderCacheKey(entry) {
  return JSON.stringify([
    entry.id,
    String(entry.statistics.totalPlanted),
    String(entry.statistics.totalHarvested),
    entry.statistics.highestWeightUnits,
    Boolean(entry.discovered),
  ]);
}

class FarmingIndexRenderer {
  constructor(options = {}) {
    assertIndexCanvasFontAvailable();
    this.loadImage = options.loadImage || loadImage;
    this.backgroundPath = options.backgroundPath || INDEX_BACKGROUND_PATH;
    this.backgroundPromise = null;
    this.spritePromises = new Map();
    this.renderCache = new Map();
    this.maximumCacheEntries = options.maximumCacheEntries || 24;
  }

  background() {
    if (!this.backgroundPromise) this.backgroundPromise = this.loadImage(this.backgroundPath);
    return this.backgroundPromise;
  }

  sprite(source) {
    const key = String(source);
    if (!this.spritePromises.has(key)) {
      this.spritePromises.set(key, loadTrimmedImage(source, this.loadImage).catch(() => null));
    }
    return this.spritePromises.get(key);
  }

  async render(entry) {
    const key = renderCacheKey(entry);
    if (this.renderCache.has(key)) return this.renderCache.get(key);
    const pending = this.renderUncached(entry).catch((error) => {
      this.renderCache.delete(key);
      throw error;
    });
    this.renderCache.set(key, pending);
    if (this.renderCache.size > this.maximumCacheEntries) this.renderCache.delete(this.renderCache.keys().next().value);
    return pending;
  }

  async renderUncached(entry) {
    const [background, seedImage, cropImage] = await Promise.all([
      this.background(),
      this.sprite(entry.seedImagePath),
      this.sprite(entry.cropImagePath),
    ]);
    const canvas = createCanvas(INDEX_CANVAS_WIDTH, INDEX_CANVAS_HEIGHT);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    drawContained(context, background, { x: 0, y: 0, width: INDEX_CANVAS_WIDTH, height: INDEX_CANVAS_HEIGHT });
    if (seedImage) drawContained(context, seedImage, insetBox(INDEX_IMAGE_BOXES.seed), entry.discovered === false);
    if (cropImage) drawContained(context, cropImage, insetBox(INDEX_IMAGE_BOXES.crop), entry.discovered === false);
    const values = rowValues(entry);
    drawRows(context, values.seed, INDEX_ROW_X.seed);
    drawRows(context, values.crop, INDEX_ROW_X.crop);
    return canvas.toBuffer('image/png');
  }

  invalidate() {
    this.renderCache.clear();
  }

  clear() {
    this.backgroundPromise = null;
    this.spritePromises.clear();
    this.renderCache.clear();
  }
}

module.exports = {
  INDEX_BACKGROUND_PATH,
  INDEX_ARTWORK_INSET,
  INDEX_CANVAS_HEIGHT,
  INDEX_CANVAS_WIDTH,
  INDEX_IMAGE_BOXES,
  INDEX_ROW_HEIGHT,
  INDEX_ROW_WIDTH,
  INDEX_ROW_X,
  INDEX_ROW_Y,
  FarmingIndexRenderer,
  containDimensions,
  fitText,
  insetBox,
  silhouetteFor,
  renderCacheKey,
  rowValues,
};
