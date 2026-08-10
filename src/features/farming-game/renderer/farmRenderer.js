const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  CARROT_STAGE_ASSET_PATHS,
  FARM_BASE_IMAGE_PATH,
  FARM_CANVAS_HEIGHT,
  FARM_CANVAS_WIDTH,
  STAGE_RENDER_HEIGHTS,
} = require('./config');

function alphaBounds(context, width, height) {
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[((y * width) + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function loadTrimmedImage(source, imageLoader = loadImage) {
  const image = await imageLoader(source);
  const sourceCanvas = createCanvas(image.width, image.height);
  const sourceContext = sourceCanvas.getContext('2d');
  sourceContext.imageSmoothingEnabled = false;
  sourceContext.drawImage(image, 0, 0);
  const bounds = alphaBounds(sourceContext, image.width, image.height);
  if (!bounds) throw new Error(`Farm sprite contains no visible pixels: ${source}`);
  const canvas = createCanvas(bounds.width, bounds.height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  return canvas;
}

function renderKey(state) {
  return JSON.stringify((state?.plots || []).map((plot) => [
    plot.plotNumber,
    plot.cropId,
    plot.plantedAt,
    plot.stage,
    plot.anchors,
  ]));
}

class FarmRenderer {
  constructor(options = {}) {
    this.loadImage = options.loadImage || loadImage;
    this.baseImagePath = options.baseImagePath || FARM_BASE_IMAGE_PATH;
    this.stageAssetPaths = options.stageAssetPaths || CARROT_STAGE_ASSET_PATHS;
    this.baseImagePromise = null;
    this.spritePromises = new Map();
    this.renderCache = new Map();
    this.maximumCacheEntries = options.maximumCacheEntries || 50;
  }

  baseImage() {
    this.baseImagePromise ||= this.loadImage(this.baseImagePath);
    return this.baseImagePromise;
  }

  stageSprite(stage) {
    const normalized = Math.max(0, Math.min(6, Math.floor(Number(stage) || 0)));
    if (!this.spritePromises.has(normalized)) {
      this.spritePromises.set(normalized, loadTrimmedImage(this.stageAssetPaths[normalized], this.loadImage));
    }
    return this.spritePromises.get(normalized);
  }

  async render(state) {
    const key = renderKey(state);
    const cached = this.renderCache.get(key);
    if (cached) return cached;
    const canvas = createCanvas(FARM_CANVAS_WIDTH, FARM_CANVAS_HEIGHT);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(await this.baseImage(), 0, 0, FARM_CANVAS_WIDTH, FARM_CANVAS_HEIGHT);
    for (const plot of state?.plots || []) {
      if (!plot.occupied || plot.cropId !== 'carrot' || !Array.isArray(plot.anchors)) continue;
      const stage = Math.max(0, Math.min(6, Number(plot.stage) || 0));
      const sprite = await this.stageSprite(stage);
      const height = STAGE_RENDER_HEIGHTS[stage];
      const width = Math.max(1, Math.round((sprite.width / sprite.height) * height));
      const anchors = [...plot.anchors].sort((left, right) => left.y - right.y || left.x - right.x);
      for (const anchor of anchors) {
        context.drawImage(sprite, Math.round(anchor.x - (width / 2)), Math.round(anchor.y - height), width, height);
      }
    }
    const buffer = canvas.toBuffer('image/png');
    if (this.renderCache.size >= this.maximumCacheEntries) {
      this.renderCache.delete(this.renderCache.keys().next().value);
    }
    this.renderCache.set(key, buffer);
    return buffer;
  }

  clear() {
    this.baseImagePromise = null;
    this.spritePromises.clear();
    this.renderCache.clear();
  }
}

module.exports = { FarmRenderer, alphaBounds, loadTrimmedImage, renderKey };
