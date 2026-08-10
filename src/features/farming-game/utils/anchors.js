const { randomInt } = require('crypto');
const {
  ANCHOR_MINIMUM_SEPARATION,
  ANCHOR_RETRY_LIMIT,
  anchorBounds,
} = require('../renderer/config');

const FALLBACK_POSITIONS = Object.freeze([
  Object.freeze([0.18, 0.18]),
  Object.freeze([0.82, 0.18]),
  Object.freeze([0.50, 0.50]),
  Object.freeze([0.20, 0.84]),
  Object.freeze([0.80, 0.84]),
]);

function secureRandomInt(maximum) {
  return randomInt(maximum);
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function fallbackAnchors(bounds) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return FALLBACK_POSITIONS.map(([x, y]) => ({
    x: Math.round(bounds.minX + (width * x)),
    y: Math.round(bounds.minY + (height * y)),
  }));
}

function generatePlotAnchors(plotNumber, rng = secureRandomInt) {
  const bounds = anchorBounds(plotNumber);
  if (!bounds) throw new RangeError(`Invalid farm plot: ${plotNumber}.`);
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const anchors = [];
  for (let index = 0; index < 5; index += 1) {
    let accepted = null;
    for (let attempt = 0; attempt < ANCHOR_RETRY_LIMIT; attempt += 1) {
      const offsetX = Number(rng(width));
      const offsetY = Number(rng(height));
      if (!Number.isInteger(offsetX) || offsetX < 0 || offsetX >= width
        || !Number.isInteger(offsetY) || offsetY < 0 || offsetY >= height) continue;
      const candidate = {
        x: bounds.minX + offsetX,
        y: bounds.minY + offsetY,
      };
      if (anchors.every((anchor) => distance(anchor, candidate) >= ANCHOR_MINIMUM_SEPARATION)) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted) return fallbackAnchors(bounds);
    anchors.push(accepted);
  }
  return anchors;
}

function validPlotAnchors(plotNumber, anchors) {
  const bounds = anchorBounds(plotNumber);
  if (!bounds || !Array.isArray(anchors) || anchors.length !== 5) return false;
  return anchors.every((anchor) => Number.isInteger(anchor?.x)
    && Number.isInteger(anchor?.y)
    && anchor.x >= bounds.minX && anchor.x <= bounds.maxX
    && anchor.y >= bounds.minY && anchor.y <= bounds.maxY);
}

module.exports = {
  FALLBACK_POSITIONS,
  fallbackAnchors,
  generatePlotAnchors,
  validPlotAnchors,
};
