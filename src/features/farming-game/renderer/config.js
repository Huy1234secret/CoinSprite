const path = require('path');

const FARM_CANVAS_WIDTH = 1254;
const FARM_CANVAS_HEIGHT = 1254;
const FARM_BASE_IMAGE_PATH = path.join(__dirname, '..', '..', '..', '..', 'images', 'farmSkin', 'Default.png');
const GROWTH_ASSET_DIRECTORY = path.join(__dirname, '..', '..', '..', '..', 'images', 'seed', 'growingStages');

const CARROT_STAGE_ASSET_PATHS = Object.freeze([
  path.join(GROWTH_ASSET_DIRECTORY, 'CarrotST0.png'),
  ...Array.from({ length: 6 }, (_, index) => path.join(GROWTH_ASSET_DIRECTORY, `carrot_stage_${index + 1}.png`)),
]);

// Rectangles follow the visible soil interiors in images/farmSkin/Default.png.
// Coordinates are kept here so anchor generation and rendering share one source
// of truth and future skins can replace the geometry without touching game logic.
const PLOT_RECTS = Object.freeze([
  Object.freeze({ number: 1, x: 286, y: 309, width: 214, height: 197 }),
  Object.freeze({ number: 2, x: 521, y: 309, width: 214, height: 197 }),
  Object.freeze({ number: 3, x: 751, y: 309, width: 212, height: 197 }),
  Object.freeze({ number: 4, x: 286, y: 520, width: 214, height: 197 }),
  Object.freeze({ number: 5, x: 521, y: 520, width: 214, height: 197 }),
  Object.freeze({ number: 6, x: 751, y: 520, width: 212, height: 197 }),
  Object.freeze({ number: 7, x: 286, y: 730, width: 214, height: 192 }),
  Object.freeze({ number: 8, x: 521, y: 730, width: 214, height: 192 }),
  Object.freeze({ number: 9, x: 751, y: 730, width: 212, height: 192 }),
]);

const PLOT_BY_NUMBER = Object.freeze(Object.fromEntries(PLOT_RECTS.map((plot) => [plot.number, plot])));
const FINAL_SPRITE_WIDTH = 66;
const FINAL_SPRITE_HEIGHT = 72;
const ANCHOR_MARGIN_X = 38;
const ANCHOR_MARGIN_TOP = 78;
const ANCHOR_MARGIN_BOTTOM = 16;
const ANCHOR_MINIMUM_SEPARATION = 38;
const ANCHOR_RETRY_LIMIT = 80;
const STAGE_RENDER_HEIGHTS = Object.freeze([28, 24, 32, 42, 52, 62, FINAL_SPRITE_HEIGHT]);

function anchorBounds(plotNumber) {
  const plot = PLOT_BY_NUMBER[Number(plotNumber)];
  if (!plot) return null;
  return Object.freeze({
    minX: plot.x + ANCHOR_MARGIN_X,
    maxX: plot.x + plot.width - ANCHOR_MARGIN_X,
    minY: plot.y + ANCHOR_MARGIN_TOP,
    maxY: plot.y + plot.height - ANCHOR_MARGIN_BOTTOM,
  });
}

module.exports = {
  ANCHOR_MINIMUM_SEPARATION,
  ANCHOR_RETRY_LIMIT,
  CARROT_STAGE_ASSET_PATHS,
  FARM_BASE_IMAGE_PATH,
  FARM_CANVAS_HEIGHT,
  FARM_CANVAS_WIDTH,
  FINAL_SPRITE_HEIGHT,
  FINAL_SPRITE_WIDTH,
  PLOT_BY_NUMBER,
  PLOT_RECTS,
  STAGE_RENDER_HEIGHTS,
  anchorBounds,
};
