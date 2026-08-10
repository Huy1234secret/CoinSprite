const { CARROT_GROWTH_DURATION_MS, STAGE_DURATION_MS } = require('../data/growth');

function growthStage(plantedAt, now = Date.now()) {
  const planted = Number(plantedAt);
  const current = Number(now);
  if (!Number.isFinite(planted) || planted < 0 || !Number.isFinite(current)) return null;
  return Math.max(0, Math.min(6, Math.floor(Math.max(0, current - planted) / STAGE_DURATION_MS)));
}

function readyAt(plantedAt) {
  const planted = Number(plantedAt);
  return Number.isFinite(planted) && planted >= 0 ? planted + CARROT_GROWTH_DURATION_MS : null;
}

function enrichPlot(plot, now = Date.now()) {
  const occupied = Boolean(plot?.cropId && plot?.plantedAt != null);
  const stage = occupied ? growthStage(plot.plantedAt, now) : null;
  return {
    ...plot,
    occupied,
    empty: !occupied,
    stage,
    ready: stage === 6,
    readyAt: occupied ? readyAt(plot.plantedAt) : null,
  };
}

module.exports = { enrichPlot, growthStage, readyAt };
