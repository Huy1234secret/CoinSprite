const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  CARROT_STAGE_ASSET_PATHS,
  FARM_BASE_IMAGE_PATH,
  FARM_CANVAS_HEIGHT,
  FARM_CANVAS_WIDTH,
  PLOT_BY_NUMBER,
  STAGE_TARGET_LONG_SIDES,
} = require('./config');
const { carrotWeightScale } = require('../utils/crops');

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

function normalizeSelectedPlotNumbers(values) {
  return [...new Set((values || []).map(Number).filter((number) => (
    Number.isInteger(number) && number >= 1 && number <= 9
  )))].sort((left, right) => left - right);
}

function renderKey(state, options = {}) {
  return JSON.stringify({
    plots: (state?.plots || []).map((plot) => [
      plot.plotNumber,
      plot.cropId,
      plot.plantedAt,
      plot.stage,
      (plot.cropInstances || []).map((crop) => [
        crop.id,
        crop.weightUnits,
        crop.seedRotationDegrees,
        crop.anchorX,
        crop.anchorY,
      ]),
      plot.cropInstances ? undefined : plot.anchors,
    ]),
    selectedPlotNumbers: normalizeSelectedPlotNumbers(options.selectedPlotNumbers),
  });
}

function normalizedStageDimensions(sprite, stage) {
  const normalizedStage = Math.max(0, Math.min(6, Math.floor(Number(stage) || 0)));
  const target = STAGE_TARGET_LONG_SIDES[normalizedStage];
  const longestSourceSide = Math.max(sprite.width, sprite.height);
  const scale = target / longestSourceSide;
  return {
    width: Math.max(1, Math.round(sprite.width * scale)),
    height: Math.max(1, Math.round(sprite.height * scale)),
  };
}

function stageRenderDimensions(sprite, stage, weightUnits) {
  const normalized = normalizedStageDimensions(sprite, stage);
  const scale = carrotWeightScale(weightUnits);
  return {
    width: Math.max(1, Math.round(normalized.width * scale)),
    height: Math.max(1, Math.round(normalized.height * scale)),
    scale,
  };
}

function normalizedRotationDegrees(value) {
  const degrees = Number(value);
  if (!Number.isFinite(degrees)) return 0;
  return ((Math.round(degrees) % 360) + 360) % 360;
}

function rotatedBounds(width, height, rotationDegrees) {
  const radians = (normalizedRotationDegrees(rotationDegrees) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: (width * cosine) + (height * sine),
    height: (width * sine) + (height * cosine),
  };
}

function safeDrawCenter(plot, anchor, boundsWidth, boundsHeight) {
  const inset = 6;
  const minimumX = plot.x + inset + (boundsWidth / 2);
  const maximumX = plot.x + plot.width - inset - (boundsWidth / 2);
  const minimumY = plot.y + inset + (boundsHeight / 2);
  const maximumY = plot.y + plot.height - inset - (boundsHeight / 2);
  const desiredX = Number(anchor.x);
  const desiredY = Number(anchor.y) - (boundsHeight / 2);
  return {
    x: Math.max(minimumX, Math.min(maximumX, desiredX)),
    y: Math.max(minimumY, Math.min(maximumY, desiredY)),
  };
}

function safeDrawRect(plot, anchor, width, height) {
  const inset = 6;
  const minimumX = plot.x + inset;
  const maximumX = plot.x + plot.width - inset - width;
  const minimumY = plot.y + inset;
  const maximumY = plot.y + plot.height - inset - height;
  const desiredX = Math.round(anchor.x - (width / 2));
  const desiredY = Math.round(anchor.y - height);
  return {
    x: Math.max(minimumX, Math.min(maximumX, desiredX)),
    y: Math.max(minimumY, Math.min(maximumY, desiredY)),
    width,
    height,
  };
}

class FarmRenderer {
  constructor(options = {}) {
    this.loadImage = options.loadImage || loadImage;
    this.baseImagePath = options.baseImagePath || FARM_BASE_IMAGE_PATH;
    this.stageAssetPaths = options.stageAssetPaths || CARROT_STAGE_ASSET_PATHS;
    this.baseImagePromise = null;
    this.spritePromises = new Map();
    this.renderCache = new Map();
    this.maximumCacheEntries = options.maximumCacheEntries || 12;
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

  async render(state, options = {}) {
    const key = renderKey(state, options);
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
      const plotRect = PLOT_BY_NUMBER[plot.plotNumber];
      if (!plotRect) continue;
      const crops = Array.isArray(plot.cropInstances) && plot.cropInstances.length
        ? plot.cropInstances.map((crop) => ({
          id: crop.id,
          weightUnits: crop.weightUnits,
          seedRotationDegrees: crop.seedRotationDegrees,
          anchor: crop.anchor || { x: crop.anchorX, y: crop.anchorY },
        }))
        : plot.anchors.map((anchor, index) => ({
          id: String(index),
          weightUnits: 50,
          seedRotationDegrees: (index * 73) % 360,
          anchor,
        }));
      crops.sort((left, right) => (
        left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x || left.id.localeCompare(right.id)
      ));
      for (const crop of crops) {
        const dimensions = stageRenderDimensions(sprite, stage, crop.weightUnits);
        if (stage === 0) {
          const rotationDegrees = normalizedRotationDegrees(crop.seedRotationDegrees);
          const bounds = rotatedBounds(dimensions.width, dimensions.height, rotationDegrees);
          const center = safeDrawCenter(plotRect, crop.anchor, bounds.width, bounds.height);
          context.save();
          context.translate(center.x, center.y);
          context.rotate((rotationDegrees * Math.PI) / 180);
          context.drawImage(
            sprite,
            -(dimensions.width / 2),
            -(dimensions.height / 2),
            dimensions.width,
            dimensions.height,
          );
          context.restore();
        } else {
          const draw = safeDrawRect(plotRect, crop.anchor, dimensions.width, dimensions.height);
          context.drawImage(sprite, draw.x, draw.y, draw.width, draw.height);
        }
      }
    }
    const selected = new Set(normalizeSelectedPlotNumbers(options.selectedPlotNumbers));
    for (const plot of state?.plots || []) {
      if (!selected.has(Number(plot.plotNumber))) continue;
      const plotRect = PLOT_BY_NUMBER[plot.plotNumber];
      if (!plotRect) continue;
      context.save();
      context.strokeStyle = '#FFFFFF';
      context.lineWidth = 4;
      context.setLineDash([14, 10]);
      context.strokeRect(
        plotRect.x + 6,
        plotRect.y + 6,
        plotRect.width - 12,
        plotRect.height - 12,
      );
      context.restore();
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

module.exports = {
  FarmRenderer,
  alphaBounds,
  loadTrimmedImage,
  normalizedRotationDegrees,
  normalizedStageDimensions,
  normalizeSelectedPlotNumbers,
  renderKey,
  rotatedBounds,
  safeDrawCenter,
  safeDrawRect,
  stageRenderDimensions,
};
