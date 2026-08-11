const { generatePlotAnchors } = require('../utils/anchors');
const { generateCarrot } = require('../utils/crops');
const { enrichPlot } = require('../utils/growth');
const { FARMING_CATALOG } = require('../data/catalog');

class FarmingGameService {
  constructor(options) {
    this.repository = options.repository;
    this.clock = options.clock || Date.now;
    this.rng = options.rng;
    this.idGenerator = options.idGenerator;
    this.anchorGenerator = options.anchorGenerator
      || ((plotNumber) => generatePlotAnchors(plotNumber, this.rng));
  }

  ensureProfile(userId) {
    return this.repository.ensureProfile(String(userId), this.clock());
  }

  farmState(userId) {
    const now = this.clock();
    return {
      ownerId: String(userId),
      now,
      plots: this.repository.plots(String(userId), now).map((plot) => enrichPlot(plot, now)),
    };
  }

  inventory(userId) {
    return this.repository.inventoryState(String(userId), this.clock());
  }

  balance(userId) {
    return this.repository.ensureProfile(String(userId), this.clock()).balance;
  }

  indexState(userId) {
    const ownerId = String(userId);
    const now = this.clock();
    return {
      ownerId,
      entries: FARMING_CATALOG.map((entry) => ({
        ...entry,
        statistics: this.repository.cropStatistics(ownerId, entry.crop.id, now),
      })),
    };
  }

  plant(userId, plotNumbers, itemId) {
    return this.repository.plant(
      String(userId),
      plotNumbers,
      itemId,
      this.anchorGenerator,
      () => generateCarrot(this.rng, this.idGenerator),
      this.clock(),
    );
  }

  harvest(userId, plotNumbers) {
    return this.repository.harvest(String(userId), plotNumbers, this.clock());
  }

  shovel(userId, plotNumbers) {
    return this.repository.shovel(String(userId), plotNumbers, this.clock());
  }

  sellCrops(userId, cropIds, sessionId) {
    return this.repository.sellCrops(
      String(userId),
      cropIds,
      `crop-sale:${String(sessionId)}`,
      this.clock(),
    );
  }
}

module.exports = { FarmingGameService };
