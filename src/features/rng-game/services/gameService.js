const { cascadingRoll } = require('./rngService');
const { emitSuccessfulRoll } = require('./rollEvent');
const { MAX_BIG_CROP_TIER, MAX_LUCK_TIER } = require('../config/upgrades');
const {
  ceilPositiveFraction,
  netExpectedValueFraction,
  targetHoursFraction,
} = require('./economyService');

const ROLL_COOLDOWN_MS = 5_000;
const SQLITE_INTEGER_MAX = 9_223_372_036_854_775_807n;

function normalizedTier(tier) {
  return BigInt(Math.max(0, Math.floor(Number(tier) || 0)));
}

function sqliteSafeCost(cost) {
  if (cost < 0n || cost > SQLITE_INTEGER_MAX) {
    throw new RangeError('Upgrade cost exceeds SQLite signed 64-bit range.');
  }
  return cost;
}

function upgradeCost(tier) {
  const t = normalizedTier(tier);
  return sqliteSafeCost(1_000n + (5_000n * t) + (100n * t * t));
}

function rawPowerUpgradePrice(upgradeNumber, kind) {
  const n = BigInt(upgradeNumber);
  const referenceLuck = Number(n - 1n > BigInt(MAX_LUCK_TIER) ? BigInt(MAX_LUCK_TIER) : n - 1n);
  const referenceBig = Number(n - 1n > BigInt(MAX_BIG_CROP_TIER) ? BigInt(MAX_BIG_CROP_TIER) : n - 1n);
  const hours = targetHoursFraction(n);
  const net = netExpectedValueFraction(referenceLuck, referenceBig);
  const kindNumerator = kind === 'big' ? 3n : 1n;
  const kindDenominator = kind === 'big' ? 5n : 1n;
  const numerator = 720n * hours.numerator * net.numerator * kindNumerator;
  const denominator = hours.denominator * net.denominator * kindDenominator;
  return ceilPositiveFraction(numerator, denominator * 1_000n) * 1_000n;
}

function powerUpgradePriceTable(maximum, kind) {
  const prices = [0n];
  for (let n = 1; n <= maximum; n += 1) {
    const rounded = rawPowerUpgradePrice(BigInt(n), kind);
    prices.push(sqliteSafeCost(rounded > prices[n - 1] ? rounded : prices[n - 1] + 1_000n));
  }
  return Object.freeze(prices);
}

const LUCK_UPGRADE_PRICES = powerUpgradePriceTable(MAX_LUCK_TIER, 'luck');
const BIG_UPGRADE_PRICES = powerUpgradePriceTable(MAX_BIG_CROP_TIER, 'big');

function luckUpgradeCost(tier) {
  const t = normalizedTier(tier);
  if (t >= BigInt(MAX_LUCK_TIER)) throw new RangeError('Luck is already at maximum tier.');
  return LUCK_UPGRADE_PRICES[Number(t + 1n)];
}

function bigUpgradeCost(tier) {
  const t = normalizedTier(tier);
  if (t >= BigInt(MAX_BIG_CROP_TIER)) throw new RangeError('BIG crop chance is already at maximum tier.');
  return BIG_UPGRADE_PRICES[Number(t + 1n)];
}

class RngGameService {
  constructor(options) {
    this.repository = options.repository;
    this.saleSessions = options.saleSessions;
    this.rng = options.rng;
    this.clock = options.clock || Date.now;
    this.cooldownMs = options.cooldownMs || ROLL_COOLDOWN_MS;
    this.onDiscovery = options.onDiscovery || (() => {});
    this.onSuccessfulRoll = options.onSuccessfulRoll || (() => {});
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
    emitSuccessfulRoll(this.onSuccessfulRoll, id, result, options.source || 'manual');
    return result;
  }

  inventory(userId) {
    return this.repository.inventoryState(String(userId), this.clock());
  }

  balance(userId) {
    return this.repository.getPlayer(String(userId), this.clock()).balance;
  }

  statistics(userId) {
    return this.repository.statistics(String(userId), this.clock());
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
  BIG_UPGRADE_PRICES,
  LUCK_UPGRADE_PRICES,
  bigUpgradeCost,
  luckUpgradeCost,
  normalizedTier,
  rawPowerUpgradePrice,
  upgradeCost,
};
