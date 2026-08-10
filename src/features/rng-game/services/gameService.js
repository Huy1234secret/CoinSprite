const { cascadingRoll } = require('./rngService');

const ROLL_COOLDOWN_MS = 5_000;
const SQLITE_INTEGER_MAX = 9_223_372_036_854_775_807n;

function normalizedTier(tier) {
  return BigInt(Math.max(0, Math.floor(Number(tier) || 0)));
}

function sqliteSafeCost(cost) {
  if (cost > SQLITE_INTEGER_MAX) {
    throw new RangeError('Upgrade cost exceeds SQLite signed 64-bit range.');
  }
  return cost;
}

function upgradeCost(tier) {
  const t = normalizedTier(tier);
  return sqliteSafeCost(1_000n + (5_000n * t) + (100n * t * t));
}

function luckUpgradeCost(tier) {
  const t = normalizedTier(tier);
  return sqliteSafeCost(10_000n + (5_000n * t * (t + 1n)));
}

function bigUpgradeCost(tier) {
  const t = normalizedTier(tier);
  return sqliteSafeCost(5_000n + (2_500n * t) + (500n * t * t));
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
  luckUpgradeCost,
  normalizedTier,
  upgradeCost,
};
