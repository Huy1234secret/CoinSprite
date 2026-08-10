const { STAGE_DURATION_MS } = require('../data/growth');
const { farmPayload } = require('../components/builders');

function nextGrowthBoundary(state, now) {
  const boundaries = (state?.plots || []).filter((plot) => plot.occupied && plot.stage < 6).map((plot) => (
    plot.plantedAt + ((plot.stage + 1) * STAGE_DURATION_MS)
  )).filter((timestamp) => timestamp > now);
  return boundaries.length ? Math.min(...boundaries) : null;
}

class FarmViewRefreshScheduler {
  constructor(options) {
    this.clock = options.clock || Date.now;
    this.farmingService = options.farmingService;
    this.farmRenderer = options.farmRenderer;
    this.farmViews = options.farmViews;
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.timers = new Map();
  }

  cancel(viewId) {
    const timer = this.timers.get(String(viewId));
    if (timer !== undefined) this.clearTimer(timer);
    this.timers.delete(String(viewId));
  }

  schedule(view) {
    this.cancel(view.id);
    const activeView = this.farmViews.get(view.id, { touch: false });
    if (!activeView?.editOriginal) return null;
    const now = this.clock();
    const state = this.farmingService.farmState(activeView.ownerId);
    const boundary = nextGrowthBoundary(state, now);
    if (!boundary) return null;
    const timer = this.setTimer(async () => {
      this.timers.delete(activeView.id);
      const current = this.farmViews.get(activeView.id, { touch: false });
      if (!current?.editOriginal) return;
      try {
        const freshState = this.farmingService.farmState(current.ownerId);
        const image = await this.farmRenderer.render(freshState);
        await current.editOriginal(farmPayload(current.ownerId, freshState, current, image, { initial: false }));
      } catch {
        // The next explicit interaction can retry a failed render or message edit.
      }
      this.schedule(current);
    }, Math.max(1, boundary - now));
    timer?.unref?.();
    this.timers.set(activeView.id, timer);
    return timer;
  }

  clear() {
    for (const timer of this.timers.values()) this.clearTimer(timer);
    this.timers.clear();
  }
}

module.exports = { FarmViewRefreshScheduler, nextGrowthBoundary };
