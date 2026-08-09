const { cascadingRoll } = require('./rngService');

const ROLL_COOLDOWN_MS = 5_000;

function upgradeCost(level) {
  const upgradeLevel = Math.max(0, Math.floor(Number(level) || 0));
  const numerator = 3_000n * (7n ** BigInt(upgradeLevel));
  const denominator = 4n ** BigInt(upgradeLevel);
  return ((numerator + 50n * denominator) / (100n * denominator)) * 100n;
}

class RngGameService {
  constructor(options) {
    this.repository = options.repository;
    this.saleSessions = options.saleSessions;
    this.rng = options.rng;
    this.clock = options.clock || Date.now;
    this.cooldownMs = options.cooldownMs || ROLL_COOLDOWN_MS;
  }

  roll(userId, options = {}) {
    const id = String(userId);
    if (this.saleSessions.has(id)) return { status: 'locked' };
    return this.repository.roll(id, () => cascadingRoll({ rng: this.rng }), {
      now: this.clock(),
      cooldownMs: this.cooldownMs,
      bypassCooldown: options.bypassCooldown === true,
      isLocked: () => this.saleSessions.has(id),
    });
  }

  inventory(userId) {
    return this.repository.inventoryState(String(userId), this.clock());
  }

  balance(userId) {
    return this.repository.getPlayer(String(userId), this.clock()).balance;
  }

  sell(userId, itemIds, sessionId) {
    return this.repository.sell(String(userId), itemIds, `sale:${sessionId}`, this.clock());
  }

  upgrade(userId, actionId) {
    return this.repository.upgrade(String(userId), `upgrade:${actionId}`, upgradeCost, this.clock());
  }
}

module.exports = { ROLL_COOLDOWN_MS, RngGameService, upgradeCost };
