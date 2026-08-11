const { generatePlotAnchors } = require('../utils/anchors');
const { generateCarrot } = require('../utils/crops');
const { enrichPlot } = require('../utils/growth');
const { FARMING_CATALOG } = require('../data/catalog');
const { farmingChanceDistribution } = require('./chanceService');

class FarmingGameService {
  constructor(options) {
    this.repository = options.repository;
    this.catalog = options.catalog || FARMING_CATALOG;
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

  profile(userId) {
    return this.repository.ensureProfile(String(userId), this.clock());
  }

  chanceDistribution(multiplier) {
    return farmingChanceDistribution(multiplier, { catalog: this.catalog });
  }

  indexState(userId) {
    const ownerId = String(userId);
    const now = this.clock();
    return {
      ownerId,
      entries: this.catalog.map((entry) => {
        const statistics = this.repository.cropStatistics(ownerId, entry.crop.id, now);
        const discovered = statistics.totalPlanted > 0n || statistics.totalHarvested > 0n;
        return { ...entry, statistics, discovered };
      }).filter((entry) => (
        entry.discovered || (entry.secretUntilDiscovered !== true && entry.crop.rarity !== 'Secret')
      )),
    };
  }

  plant(userId, plotNumbers, itemId) {
    const profile = this.repository.ensureProfile(String(userId), this.clock());
    return this.repository.plant(
      String(userId),
      plotNumbers,
      itemId,
      this.anchorGenerator,
      () => generateCarrot(this.rng, this.idGenerator, { bigCropTier: profile.bigCropTier }),
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

  sellCropQuantity(userId, cropId, quantity, operationId) {
    return this.repository.sellCropQuantity(
      String(userId), cropId, quantity, `crop-quantity-sale:${String(operationId)}`, this.clock(),
    );
  }

  purchaseUpgrade(userId, type, operationId) {
    return this.repository.purchaseUpgrade(
      String(userId), type, `farming-upgrade:${String(operationId)}`, this.clock(),
    );
  }
}

module.exports = { FarmingGameService };
