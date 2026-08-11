const SQLITE_INTEGER_MAX = 9_223_372_036_854_775_807n;
const {
  MAX_BIG_CROP_TIER,
  MAX_LUCK_TIER,
} = require('../config/upgrades');
const DEFAULT_CAPACITY = 100n;
const { statisticsModel } = require('../services/statisticsService');

function inventoryItem(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    ownerUserId: row.owner_user_id,
    seedId: row.seed_id,
    cropName: row.crop_name,
    rarity: row.rarity,
    weightUnits: Number(row.weight_units),
    value: row.stored_value,
    isBig: Boolean(row.is_big),
    rolledAt: Number(row.rolled_at),
  };
}

function playerRecord(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    balance: row.sheckle_balance,
    inventoryCapacity: Number(row.inventory_capacity),
    upgradeLevel: Number(row.inventory_upgrade_level),
    luckTier: Number(row.luck_tier),
    bigCropTier: Number(row.big_crop_tier),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function operationResult(row) {
  if (!row) return null;
  const parsed = JSON.parse(row.result_json);
  if (parsed.total != null) parsed.total = BigInt(parsed.total);
  if (parsed.cost != null) parsed.cost = BigInt(parsed.cost);
  if (parsed.balance != null) parsed.balance = BigInt(parsed.balance);
  return { ...parsed, duplicate: true };
}

function statisticsAggregate(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    totalRolls: row.total_rolls,
    autoRolls: row.auto_rolls,
    highestWeightUnits: Number(row.highest_weight_units),
    totalSaleEarnings: row.total_sale_earnings,
    highestSingleSale: row.highest_single_sale,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function cropStatistic(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    seedId: row.seed_id,
    rollCount: row.roll_count,
    highestWeightUnits: Number(row.highest_weight_units),
    firstRolledAt: Number(row.first_rolled_at),
    lastRolledAt: Number(row.last_rolled_at),
  };
}

function sqliteSafeStatistic(value, label) {
  const integer = BigInt(value);
  if (integer < 0n || integer > SQLITE_INTEGER_MAX) {
    throw new RangeError(`${label} exceeds the SQLite signed 64-bit range.`);
  }
  return integer;
}

class RngGameRepository {
  constructor(db) {
    this.db = db;
    this.statements = {
      ensurePlayer: db.prepare(`INSERT OR IGNORE INTO rng_players
        (user_id, sheckle_balance, inventory_capacity, inventory_upgrade_level, created_at, updated_at)
        VALUES (?, 0, 100, 0, ?, ?)`),
      ensureStatistics: db.prepare(`INSERT OR IGNORE INTO rng_player_statistics
        (user_id, total_rolls, auto_rolls, highest_weight_units, total_sale_earnings,
         highest_single_sale, created_at, updated_at)
        VALUES (?, 0, 0, 0, 0, 0, ?, ?)`),
      player: db.prepare('SELECT * FROM rng_players WHERE user_id = ?'),
      statistics: db.prepare('SELECT * FROM rng_player_statistics WHERE user_id = ?'),
      cropStatistics: db.prepare(`SELECT * FROM rng_crop_statistics
        WHERE user_id = ? ORDER BY seed_id`),
      cropStatistic: db.prepare(`SELECT * FROM rng_crop_statistics
        WHERE user_id = ? AND seed_id = ?`),
      updateRollStatistics: db.prepare(`UPDATE rng_player_statistics SET
        total_rolls = ?, auto_rolls = ?, highest_weight_units = ?, updated_at = ?
        WHERE user_id = ?`),
      updateSaleStatistics: db.prepare(`UPDATE rng_player_statistics SET
        total_sale_earnings = ?, highest_single_sale = ?, updated_at = ?
        WHERE user_id = ?`),
      insertCropStatistic: db.prepare(`INSERT INTO rng_crop_statistics
        (user_id, seed_id, roll_count, highest_weight_units, first_rolled_at, last_rolled_at)
        VALUES (?, ?, ?, ?, ?, ?)`),
      updateCropStatistic: db.prepare(`UPDATE rng_crop_statistics SET
        roll_count = ?, highest_weight_units = ?, last_rolled_at = ?
        WHERE user_id = ? AND seed_id = ?`),
      inventory: db.prepare(`SELECT * FROM rng_inventory_items
        WHERE owner_user_id = ? ORDER BY rolled_at DESC, id DESC`),
      inventoryCount: db.prepare('SELECT COUNT(*) AS count FROM rng_inventory_items WHERE owner_user_id = ?'),
      inventoryTotal: db.prepare('SELECT COALESCE(SUM(stored_value), 0) AS total FROM rng_inventory_items WHERE owner_user_id = ?'),
      cooldown: db.prepare('SELECT available_at FROM rng_roll_cooldowns WHERE user_id = ?'),
      saveCooldown: db.prepare(`INSERT INTO rng_roll_cooldowns (user_id, available_at) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET available_at = excluded.available_at`),
      insertItem: db.prepare(`INSERT INTO rng_inventory_items
        (owner_user_id, seed_id, crop_name, rarity, weight_units, stored_value, is_big, rolled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      discover: db.prepare(`INSERT OR IGNORE INTO rng_crop_discoveries
        (user_id, seed_id, discovered_at) VALUES (?, ?, ?)`),
      discoveries: db.prepare(`SELECT seed_id, discovered_at FROM rng_crop_discoveries
        WHERE user_id = ? ORDER BY discovered_at, seed_id`),
      item: db.prepare('SELECT * FROM rng_inventory_items WHERE id = ?'),
      deleteOwnedItem: db.prepare('DELETE FROM rng_inventory_items WHERE id = ? AND owner_user_id = ?'),
      updateBalance: db.prepare('UPDATE rng_players SET sheckle_balance = ?, updated_at = ? WHERE user_id = ?'),
      touchPlayer: db.prepare('UPDATE rng_players SET updated_at = ? WHERE user_id = ?'),
      updateUpgrade: db.prepare(`UPDATE rng_players SET sheckle_balance = ?, inventory_capacity = ?,
        inventory_upgrade_level = ?, updated_at = ? WHERE user_id = ?`),
      updatePowerUpgrade: db.prepare(`UPDATE rng_players SET sheckle_balance = ?, luck_tier = ?,
        big_crop_tier = ?, updated_at = ? WHERE user_id = ?`),
      activeAutoRoll: db.prepare(`SELECT id, next_tick_at, ends_at FROM rng_auto_roll_jobs
        WHERE user_id = ? AND status = 'active' LIMIT 1`),
      operation: db.prepare('SELECT result_json FROM rng_operations WHERE operation_key = ?'),
      saveOperation: db.prepare(`INSERT INTO rng_operations
        (operation_key, user_id, operation_kind, result_json, created_at) VALUES (?, ?, ?, ?, ?)`),
    };

    this.rollTransaction = db.transaction((userId, createInstance, now, cooldownMs, isLocked, bypassCooldown) => {
      this.ensurePlayer(userId, now);
      const player = playerRecord(this.statements.player.get(userId));
      const itemCount = this.statements.inventoryCount.get(userId).count;
      if (itemCount >= BigInt(player.inventoryCapacity)) {
        return { status: 'full', current: Number(itemCount), capacity: player.inventoryCapacity };
      }
      if (isLocked?.()) return { status: 'locked' };
      const currentTime = BigInt(now);
      if (!bypassCooldown) {
        const availableAt = this.statements.cooldown.get(userId)?.available_at || 0n;
        if (availableAt > currentTime) {
          return { status: 'cooldown', remainingMs: Number(availableAt - currentTime) };
        }
      }
      const instance = createInstance(player);
      const nextAvailableAt = currentTime + BigInt(cooldownMs);
      if (!bypassCooldown) this.statements.saveCooldown.run(userId, nextAvailableAt);
      const inserted = this.statements.insertItem.run(
        userId,
        instance.seed.id,
        instance.seed.displayName,
        instance.seed.rarity,
        BigInt(instance.weightUnits),
        BigInt(instance.value),
        instance.isBig ? 1 : 0,
        currentTime,
      );
      const discoveredNew = Number(this.statements.discover.run(userId, instance.seed.id, currentTime).changes) === 1;
      this.recordSuccessfulRoll(userId, instance.seed.id, instance.weightUnits, currentTime, false);
      this.statements.touchPlayer.run(currentTime, userId);
      return {
        status: 'ok',
        item: inventoryItem(this.statements.item.get(inserted.lastInsertRowid)),
        seed: instance.seed,
        effectiveChance: instance.effectiveChance,
        discoveredNew,
        availableAt: Number(nextAvailableAt),
      };
    }).immediate;

    this.sellTransaction = db.transaction((userId, itemIds, operationKey, now) => {
      this.ensurePlayer(userId, now);
      const prior = operationResult(this.statements.operation.get(operationKey));
      if (prior) return prior;
      const uniqueIds = [...new Set(itemIds.map(String))];
      if (!uniqueIds.length) return { status: 'empty', duplicate: false };
      const rows = uniqueIds.map((id) => {
        if (!/^\d+$/.test(id)) return null;
        return this.statements.item.get(BigInt(id));
      });
      if (rows.some((row) => !row || row.owner_user_id !== userId)) {
        return { status: 'invalid-items', duplicate: false };
      }
      const total = rows.reduce((sum, row) => sum + row.stored_value, 0n);
      const player = playerRecord(this.statements.player.get(userId));
      const balance = player.balance + total;
      if (balance > SQLITE_INTEGER_MAX) throw new RangeError('Sheckle balance exceeds SQLite signed 64-bit range.');
      for (const row of rows) {
        const deleted = this.statements.deleteOwnedItem.run(row.id, userId);
        if (Number(deleted.changes) !== 1) throw new Error('Inventory changed while completing the sale.');
      }
      this.statements.updateBalance.run(balance, BigInt(now), userId);
      this.recordSaleEarnings(userId, total, BigInt(now));
      const result = { status: 'ok', itemCount: rows.length, total, balance, duplicate: false };
      this.statements.saveOperation.run(operationKey, userId, 'sale', JSON.stringify({
        status: result.status,
        itemCount: result.itemCount,
        total: String(total),
        balance: String(balance),
      }), BigInt(now));
      return result;
    }).immediate;

    this.upgradeTransaction = db.transaction((userId, operationKey, costForLevel, now) => {
      this.ensurePlayer(userId, now);
      const prior = operationResult(this.statements.operation.get(operationKey));
      if (prior) return prior;
      const player = playerRecord(this.statements.player.get(userId));
      const cost = costForLevel(player.upgradeLevel);
      if (player.balance < cost) {
        return { status: 'insufficient', cost, missing: cost - player.balance, balance: player.balance, duplicate: false };
      }
      const nextCapacity = BigInt(player.inventoryCapacity) + 10n;
      const nextLevel = BigInt(player.upgradeLevel) + 1n;
      const balance = player.balance - cost;
      this.statements.updateUpgrade.run(balance, nextCapacity, nextLevel, BigInt(now), userId);
      const result = {
        status: 'ok', cost, balance, inventoryCapacity: Number(nextCapacity),
        upgradeLevel: Number(nextLevel), duplicate: false,
      };
      this.statements.saveOperation.run(operationKey, userId, 'upgrade', JSON.stringify({
        status: result.status,
        cost: String(cost),
        balance: String(balance),
        inventoryCapacity: result.inventoryCapacity,
        upgradeLevel: result.upgradeLevel,
      }), BigInt(now));
      return result;
    }).immediate;

    this.powerUpgradeTransaction = db.transaction((userId, kind, operationKey, costForTier, now) => {
      this.ensurePlayer(userId, now);
      const prior = operationResult(this.statements.operation.get(operationKey));
      if (prior) return prior;
      const player = playerRecord(this.statements.player.get(userId));
      if (!['luck', 'big'].includes(kind)) return { status: 'invalid-kind', duplicate: false };
      const tier = kind === 'luck' ? player.luckTier : player.bigCropTier;
      const maximumTier = kind === 'luck' ? MAX_LUCK_TIER : MAX_BIG_CROP_TIER;
      if (tier >= maximumTier) {
        const result = {
          status: 'max-tier', kind, balance: player.balance,
          luckTier: player.luckTier, bigCropTier: player.bigCropTier, duplicate: false,
        };
        this.statements.saveOperation.run(operationKey, userId, 'power-upgrade', JSON.stringify({
          ...result,
          balance: String(result.balance),
        }), BigInt(now));
        return result;
      }
      const cost = costForTier(tier);
      if (player.balance < cost) {
        return { status: 'insufficient', cost, missing: cost - player.balance, balance: player.balance, duplicate: false };
      }
      const balance = player.balance - cost;
      const luckTier = player.luckTier + (kind === 'luck' ? 1 : 0);
      const bigCropTier = player.bigCropTier + (kind === 'big' ? 1 : 0);
      this.statements.updatePowerUpgrade.run(balance, BigInt(luckTier), BigInt(bigCropTier), BigInt(now), userId);
      const result = { status: 'ok', kind, cost, balance, luckTier, bigCropTier, duplicate: false };
      this.statements.saveOperation.run(operationKey, userId, 'power-upgrade', JSON.stringify({
        ...result,
        cost: String(cost),
        balance: String(balance),
      }), BigInt(now));
      return result;
    }).immediate;
  }

  ensurePlayer(userId, now = Date.now()) {
    const id = String(userId);
    const timestamp = BigInt(now);
    this.statements.ensurePlayer.run(id, timestamp, timestamp);
    this.statements.ensureStatistics.run(id, timestamp, timestamp);
    return playerRecord(this.statements.player.get(id));
  }

  recordSuccessfulRoll(userId, seedId, weightUnits, now = Date.now(), isAutoRoll = false) {
    const id = String(userId);
    const timestamp = BigInt(now);
    this.statements.ensureStatistics.run(id, timestamp, timestamp);
    const aggregate = statisticsAggregate(this.statements.statistics.get(id));
    const totalRolls = sqliteSafeStatistic(aggregate.totalRolls + 1n, 'Total roll count');
    const autoRolls = sqliteSafeStatistic(
      aggregate.autoRolls + (isAutoRoll ? 1n : 0n),
      'Auto Roll count',
    );
    const finalWeight = sqliteSafeStatistic(weightUnits, 'Crop weight');
    const highestWeight = finalWeight > BigInt(aggregate.highestWeightUnits)
      ? finalWeight
      : BigInt(aggregate.highestWeightUnits);
    this.statements.updateRollStatistics.run(totalRolls, autoRolls, highestWeight, timestamp, id);

    const existing = cropStatistic(this.statements.cropStatistic.get(id, String(seedId)));
    if (!existing) {
      this.statements.insertCropStatistic.run(id, String(seedId), 1n, finalWeight, timestamp, timestamp);
      return;
    }
    const rollCount = sqliteSafeStatistic(existing.rollCount + 1n, 'Per-crop roll count');
    const cropHighestWeight = finalWeight > BigInt(existing.highestWeightUnits)
      ? finalWeight
      : BigInt(existing.highestWeightUnits);
    this.statements.updateCropStatistic.run(rollCount, cropHighestWeight, timestamp, id, String(seedId));
  }

  recordSaleEarnings(userId, proceeds, now = Date.now()) {
    const id = String(userId);
    const timestamp = BigInt(now);
    this.statements.ensureStatistics.run(id, timestamp, timestamp);
    const aggregate = statisticsAggregate(this.statements.statistics.get(id));
    const saleTotal = sqliteSafeStatistic(proceeds, 'Sale proceeds');
    const totalSaleEarnings = sqliteSafeStatistic(
      aggregate.totalSaleEarnings + saleTotal,
      'Total sale earnings',
    );
    const highestSingleSale = saleTotal > aggregate.highestSingleSale
      ? saleTotal
      : aggregate.highestSingleSale;
    this.statements.updateSaleStatistics.run(totalSaleEarnings, highestSingleSale, timestamp, id);
  }

  getPlayer(userId, now = Date.now()) {
    return this.ensurePlayer(userId, now);
  }

  listInventory(userId, now = Date.now()) {
    this.ensurePlayer(userId, now);
    return this.statements.inventory.all(String(userId)).map(inventoryItem);
  }

  inventoryState(userId, now = Date.now()) {
    const player = this.ensurePlayer(userId, now);
    const id = String(userId);
    const items = this.statements.inventory.all(id).map(inventoryItem);
    const totalValue = this.statements.inventoryTotal.get(id).total;
    return { player, items, totalValue, count: items.length };
  }

  discoveries(userId, now = Date.now()) {
    this.ensurePlayer(userId, now);
    return this.statements.discoveries.all(String(userId)).map((row) => ({
      seedId: row.seed_id,
      discoveredAt: Number(row.discovered_at),
    }));
  }

  cropStatistics(userId, now = Date.now()) {
    this.ensurePlayer(userId, now);
    return this.statements.cropStatistics.all(String(userId)).map(cropStatistic);
  }

  statistics(userId, now = Date.now()) {
    const id = String(userId);
    this.ensurePlayer(id, now);
    const aggregate = statisticsAggregate(this.statements.statistics.get(id));
    const discoveries = this.statements.discoveries.all(id).map((row) => ({ seedId: row.seed_id }));
    const crops = this.statements.cropStatistics.all(id).map(cropStatistic);
    return statisticsModel(aggregate, discoveries, crops);
  }

  activeAutoRoll(userId) {
    const row = this.statements.activeAutoRoll.get(String(userId));
    return row ? { id: String(row.id), nextTickAt: Number(row.next_tick_at), endsAt: Number(row.ends_at) } : null;
  }

  roll(userId, createInstance, options = {}) {
    return this.rollTransaction(
      String(userId),
      createInstance,
      options.now ?? Date.now(),
      options.cooldownMs ?? 5_000,
      options.isLocked,
      options.bypassCooldown === true,
    );
  }

  sell(userId, itemIds, operationKey, now = Date.now()) {
    return this.sellTransaction(String(userId), itemIds, String(operationKey), now);
  }

  upgrade(userId, operationKey, costForLevel, now = Date.now()) {
    return this.upgradeTransaction(String(userId), String(operationKey), costForLevel, now);
  }

  purchasePowerUpgrade(userId, kind, operationKey, costForTier, now = Date.now()) {
    return this.powerUpgradeTransaction(String(userId), String(kind), String(operationKey), costForTier, now);
  }
}

module.exports = {
  DEFAULT_CAPACITY,
  RngGameRepository,
  SQLITE_INTEGER_MAX,
  cropStatistic,
  inventoryItem,
  playerRecord,
  statisticsAggregate,
};
