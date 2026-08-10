const { cascadingRoll } = require('./rngService');

const ROLL_COOLDOWN_MS = 5_000;

function upgradeCost(level) {
  const upgradeLevel = Math.max(0, Math.floor(Number(level) || 0));
  const numerator = 3_000n * (7n ** BigInt(upgradeLevel));
  const denominator = 4n ** BigInt(upgradeLevel);
  return ((numerator + 50n * denominator) / (100n * denominator)) * 100n;
}

function exponentialUpgradeCost(base, growthNumerator, growthDenominator, tier) {
  const normalizedTier = Math.max(0, Math.min(20, Math.floor(Number(tier) || 0)));
  const numerator = BigInt(base) * (BigInt(growthNumerator) ** BigInt(normalizedTier));
  const denominator = BigInt(growthDenominator) ** BigInt(normalizedTier);
  return ((numerator + (50n * denominator)) / (100n * denominator)) * 100n;
}

function luckUpgradeCost(tier) {
  return exponentialUpgradeCost(5_000, 31, 20, tier);
}

function bigUpgradeCost(tier) {
  return exponentialUpgradeCost(3_500, 8, 5, tier);
}

class RngGameService {
  constructor(options) {
    this.repository = options.repository;
    this.saleSessions = options.saleSessions;
    this.rng = options.rng;
    this.clock = options.clock || Date.now;
    this.cooldownMs = options.cooldownMs || ROLL_COOLDOWN_MS;
    this.onDiscovery = options.onDiscovery || (() => {});
  }

  roll(userId, options = {}) {
    const id = String(userId);
    if (this.saleSessions.has(id)) return { status: 'locked' };
    if (this.repository.activeAutoRoll(id)) return { status: 'auto-active' };
    const result = this.repository.roll(id, (player) => cascadingRoll({
      rng: this.rng,
      luckTier: player.luckTier,
      bigCropTier: player.bigCropTier,
    }), {
      now: this.clock(),
      cooldownMs: this.cooldownMs,
      bypassCooldown: options.bypassCooldown === true,
      isLocked: () => this.saleSessions.has(id) || Boolean(this.repository.activeAutoRoll(id)),
    });
    if (result.discoveredNew) this.onDiscovery(id, result.seed.id);
    return result;
  }

  inventory(userId) {
    return this.repository.inventoryState(String(userId), this.clock());
  }

  balance(userId) {
    return this.repository.getPlayer(String(userId), this.clock()).balance;
  }

  sell(userId, itemIds, sessionId) {
    if (this.repository.activeAutoRoll(userId)) return { status: 'auto-active' };
    return this.repository.sell(String(userId), itemIds, `sale:${sessionId}`, this.clock());
  }

  upgrade(userId, actionId) {
    return this.repository.upgrade(String(userId), `upgrade:${actionId}`, upgradeCost, this.clock());
  }

  purchasePowerUpgrade(userId, kind, actionId) {
    const cost = kind === 'luck' ? luckUpgradeCost : bigUpgradeCost;
    return this.repository.purchasePowerUpgrade(
      String(userId),
      kind,
      `power-upgrade:${actionId}`,
      cost,
      this.clock(),
    );
  }
}

module.exports = {
  ROLL_COOLDOWN_MS,
  RngGameService,
  bigUpgradeCost,
  exponentialUpgradeCost,
  luckUpgradeCost,
  upgradeCost,
};
