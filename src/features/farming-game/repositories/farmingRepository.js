const {
  STARTER_ITEM_ID,
  STARTER_ITEM_QUANTITY,
  getItem,
} = require('../data/items');
const { growthStage } = require('../utils/growth');
const { validPlotAnchors } = require('../utils/anchors');
const { generateCarrot } = require('../utils/crops');

const SQLITE_INTEGER_MAX = 9_223_372_036_854_775_807n;

function parseAnchors(value) {
  if (!value) return [];
  try {
    const anchors = JSON.parse(value);
    return Array.isArray(anchors) ? anchors.map((anchor) => ({ x: Number(anchor.x), y: Number(anchor.y) })) : [];
  } catch {
    return [];
  }
}

function cropInstanceRecord(row) {
  if (!row) return null;
  const item = getItem(row.crop_id);
  const planted = row.state === 'planted';
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    cropId: row.crop_id,
    rarity: row.rarity,
    weightUnits: Number(row.weight_units),
    storedValue: row.stored_value,
    value: row.stored_value,
    seedRotationDegrees: Number(row.seed_rotation_degrees),
    state: row.state,
    plotNumber: row.plot_number == null ? null : Number(row.plot_number),
    anchorX: row.anchor_x == null ? null : Number(row.anchor_x),
    anchorY: row.anchor_y == null ? null : Number(row.anchor_y),
    anchor: planted ? { x: Number(row.anchor_x), y: Number(row.anchor_y) } : null,
    plantedAt: Number(row.planted_at),
    harvestedAt: row.harvested_at == null ? null : Number(row.harvested_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    item,
  };
}

function operationResult(row) {
  if (!row) return null;
  const parsed = JSON.parse(row.result_json);
  if (parsed.total != null) parsed.total = BigInt(parsed.total);
  if (parsed.balance != null) parsed.balance = BigInt(parsed.balance);
  return { ...parsed, duplicate: true };
}

function cropStatisticsRecord(row, ownerUserId, cropId) {
  return {
    ownerUserId: String(row?.owner_user_id || ownerUserId),
    cropId: String(row?.crop_id || cropId),
    totalPlanted: row?.total_planted || 0n,
    totalHarvested: row?.total_harvested || 0n,
    highestWeightUnits: Number(row?.highest_weight_units || 0),
    updatedAt: Number(row?.updated_at || 0),
  };
}

function plotRecord(row, cropInstances = []) {
  if (!row) return null;
  const instances = [...cropInstances].sort((left, right) => (
    left.anchorY - right.anchorY || left.anchorX - right.anchorX || left.id.localeCompare(right.id)
  ));
  const plantedAt = instances.length ? instances[0].plantedAt : null;
  return {
    ownerUserId: row.owner_user_id,
    plotNumber: Number(row.plot_number),
    cropId: instances.length ? instances[0].cropId : null,
    plantedAt,
    anchors: instances.map((instance) => instance.anchor),
    cropInstances: instances,
    updatedAt: Number(row.updated_at),
  };
}

function stackRecord(row) {
  if (!row) return null;
  const item = getItem(row.item_id);
  return {
    ownerUserId: row.owner_user_id,
    itemId: row.item_id,
    quantity: row.quantity,
    updatedAt: Number(row.updated_at),
    item,
  };
}

function normalizePlotNumbers(values) {
  if (!Array.isArray(values)) return [];
  const numbers = values.map(Number);
  if (numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 9)) return [];
  return [...new Set(numbers)].sort((left, right) => left - right);
}

function groupCropsByPlot(crops) {
  const grouped = new Map();
  for (const crop of crops) {
    if (!grouped.has(crop.plotNumber)) grouped.set(crop.plotNumber, []);
    grouped.get(crop.plotNumber).push(crop);
  }
  return grouped;
}

class FarmingGameRepository {
  constructor(db) {
    this.db = db;
    this.statements = {
      insertProfile: db.prepare(`INSERT OR IGNORE INTO farm_profiles
        (user_id, starter_granted, created_at, updated_at) VALUES (?, 0, ?, ?)`),
      profile: db.prepare('SELECT * FROM farm_profiles WHERE user_id = ?'),
      grantStarter: db.prepare(`UPDATE farm_profiles SET starter_granted = 1, updated_at = ?
        WHERE user_id = ? AND starter_granted = 0`),
      insertPlot: db.prepare(`INSERT OR IGNORE INTO farm_plots
        (owner_user_id, plot_number, crop_id, planted_at, anchors_json, updated_at)
        VALUES (?, ?, NULL, NULL, NULL, ?)`),
      plots: db.prepare('SELECT * FROM farm_plots WHERE owner_user_id = ? ORDER BY plot_number'),
      plot: db.prepare('SELECT * FROM farm_plots WHERE owner_user_id = ? AND plot_number = ?'),
      stacks: db.prepare(`SELECT * FROM farm_item_stacks
        WHERE owner_user_id = ? AND item_id <> 'carrot' AND quantity > 0 ORDER BY item_id`),
      stack: db.prepare(`SELECT * FROM farm_item_stacks
        WHERE owner_user_id = ? AND item_id = ? AND item_id <> 'carrot'`),
      addStack: db.prepare(`INSERT INTO farm_item_stacks (owner_user_id, item_id, quantity, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_user_id, item_id) DO UPDATE SET
          quantity = farm_item_stacks.quantity + excluded.quantity,
          updated_at = excluded.updated_at`),
      setStack: db.prepare(`INSERT INTO farm_item_stacks (owner_user_id, item_id, quantity, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_user_id, item_id) DO UPDATE SET
          quantity = excluded.quantity,
          updated_at = excluded.updated_at`),
      plantedCrops: db.prepare(`SELECT * FROM farm_crop_instances
        WHERE owner_user_id = ? AND state = 'planted'
        ORDER BY plot_number, anchor_y, anchor_x, id`),
      inventoryCrops: db.prepare(`SELECT * FROM farm_crop_instances
        WHERE owner_user_id = ? AND state = 'inventory'
        ORDER BY harvested_at DESC, created_at, id`),
      insertCrop: db.prepare(`INSERT INTO farm_crop_instances
        (id, owner_user_id, crop_id, rarity, weight_units, stored_value, seed_rotation_degrees, state,
          plot_number, anchor_x, anchor_y, planted_at, harvested_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'planted', ?, ?, ?, ?, NULL, ?, ?)`),
      harvestPlot: db.prepare(`UPDATE farm_crop_instances SET
        state = 'inventory', plot_number = NULL, anchor_x = NULL, anchor_y = NULL,
        harvested_at = ?, updated_at = ?
        WHERE owner_user_id = ? AND plot_number = ? AND state = 'planted'`),
      shovelPlot: db.prepare(`DELETE FROM farm_crop_instances
        WHERE owner_user_id = ? AND plot_number = ? AND state = 'planted'`),
      touchPlot: db.prepare(`UPDATE farm_plots SET updated_at = ?
        WHERE owner_user_id = ? AND plot_number = ?`),
      touchProfile: db.prepare('UPDATE farm_profiles SET updated_at = ? WHERE user_id = ?'),
      cropById: db.prepare('SELECT * FROM farm_crop_instances WHERE id = ?'),
      deleteInventoryCrop: db.prepare(`DELETE FROM farm_crop_instances
        WHERE id = ? AND owner_user_id = ? AND state = 'inventory'`),
      updateBalance: db.prepare('UPDATE farm_profiles SET coin_balance = ?, updated_at = ? WHERE user_id = ?'),
      operation: db.prepare('SELECT * FROM farm_operations WHERE operation_key = ?'),
      saveOperation: db.prepare(`INSERT INTO farm_operations
        (operation_key, owner_user_id, operation_kind, result_json, created_at)
        VALUES (?, ?, ?, ?, ?)`),
      cropStatistics: db.prepare(`SELECT * FROM farm_crop_statistics
        WHERE owner_user_id = ? AND crop_id = ?`),
      recordPlanted: db.prepare(`INSERT INTO farm_crop_statistics
        (owner_user_id, crop_id, total_planted, total_harvested, highest_weight_units, updated_at)
        VALUES (?, ?, ?, 0, 0, ?)
        ON CONFLICT(owner_user_id, crop_id) DO UPDATE SET
          total_planted = farm_crop_statistics.total_planted + excluded.total_planted,
          updated_at = excluded.updated_at`),
      recordHarvested: db.prepare(`INSERT INTO farm_crop_statistics
        (owner_user_id, crop_id, total_planted, total_harvested, highest_weight_units, updated_at)
        VALUES (?, ?, 0, ?, ?, ?)
        ON CONFLICT(owner_user_id, crop_id) DO UPDATE SET
          total_harvested = farm_crop_statistics.total_harvested + excluded.total_harvested,
          highest_weight_units = MAX(farm_crop_statistics.highest_weight_units, excluded.highest_weight_units),
          updated_at = excluded.updated_at`),
    };

    this.ensureProfileTransaction = db.transaction((userId, now) => this.ensureProfileRecords(userId, now)).immediate;

    this.plantTransaction = db.transaction((userId, plotNumbers, itemId, createAnchors, createCrop, now) => {
      this.ensureProfileRecords(userId, now);
      const requested = Array.isArray(plotNumbers) ? plotNumbers : [];
      const normalized = normalizePlotNumbers(requested);
      if (!normalized.length || normalized.length !== requested.length) return { status: 'invalid-plots' };
      const item = getItem(itemId);
      if (!item || !item.itemTypes.includes('seed') || !item.plantableCropId) return { status: 'invalid-item' };
      const plotRows = normalized.map((plotNumber) => this.statements.plot.get(userId, BigInt(plotNumber)));
      if (plotRows.some((plot) => !plot)) return { status: 'invalid-plots' };
      const occupied = groupCropsByPlot(this.plantedCropInstancesForOwner(userId));
      if (normalized.some((plotNumber) => occupied.has(plotNumber))) return { status: 'plots-changed' };
      const stack = stackRecord(this.statements.stack.get(userId, item.id));
      const required = BigInt(normalized.length);
      if (!stack || stack.quantity < required) {
        return { status: 'insufficient', required, available: stack?.quantity || 0n };
      }
      const cropsByPlot = normalized.map((plotNumber) => {
        const anchors = createAnchors(plotNumber);
        if (!validPlotAnchors(plotNumber, anchors)) throw new Error(`Invalid anchors generated for plot ${plotNumber}.`);
        return anchors.map((anchor) => ({ ...createCrop(), anchor }));
      });
      this.statements.setStack.run(userId, item.id, stack.quantity - required, BigInt(now));
      normalized.forEach((plotNumber, plotIndex) => {
        for (const crop of cropsByPlot[plotIndex]) {
          this.statements.insertCrop.run(
            crop.id,
            userId,
            item.plantableCropId,
            crop.rarity,
            BigInt(crop.weightUnits),
            BigInt(crop.storedValue),
            BigInt(crop.seedRotationDegrees),
            BigInt(plotNumber),
            BigInt(crop.anchor.x),
            BigInt(crop.anchor.y),
            BigInt(now),
            BigInt(now),
            BigInt(now),
          );
        }
        this.statements.touchPlot.run(BigInt(now), userId, BigInt(plotNumber));
      });
      const planted = cropsByPlot.flat();
      this.statements.recordPlanted.run(
        userId,
        item.plantableCropId,
        BigInt(planted.length),
        BigInt(now),
      );
      this.statements.touchProfile.run(BigInt(now), userId);
      return {
        status: 'ok',
        itemId: item.id,
        cropId: item.plantableCropId,
        plotNumbers: normalized,
        plantedAt: now,
        cropInstances: cropsByPlot.flat(),
        remaining: stack.quantity - required,
      };
    }).immediate;

    this.harvestTransaction = db.transaction((userId, plotNumbers, now) => {
      this.ensureProfileRecords(userId, now);
      const requested = Array.isArray(plotNumbers) ? plotNumbers : [];
      const normalized = normalizePlotNumbers(requested);
      if (!normalized.length || normalized.length !== requested.length) return { status: 'invalid-plots' };
      const rows = normalized.map((plotNumber) => this.statements.plot.get(userId, BigInt(plotNumber)));
      if (rows.some((plot) => !plot)) return { status: 'invalid-plots' };
      const grouped = groupCropsByPlot(this.plantedCropInstancesForOwner(userId));
      const readyPlots = normalized.filter((plotNumber) => {
        const crops = grouped.get(plotNumber) || [];
        return crops.length === 5
          && crops.every((crop) => crop.cropId === 'carrot' && growthStage(crop.plantedAt, now) === 6);
      });
      if (!readyPlots.length) return { status: 'nothing-ready' };
      const harvested = [];
      for (const plotNumber of readyPlots) {
        const crops = grouped.get(plotNumber);
        const changed = this.statements.harvestPlot.run(BigInt(now), BigInt(now), userId, BigInt(plotNumber));
        if (Number(changed.changes) !== crops.length) throw new Error('Farm changed while harvesting.');
        harvested.push(...crops.map((crop) => ({
          ...crop,
          state: 'inventory',
          plotNumber: null,
          anchorX: null,
          anchorY: null,
          anchor: null,
          harvestedAt: now,
          updatedAt: now,
        })));
        this.statements.touchPlot.run(BigInt(now), userId, BigInt(plotNumber));
      }
      if (harvested.length) {
        this.statements.recordHarvested.run(
          userId,
          'carrot',
          BigInt(harvested.length),
          BigInt(Math.max(...harvested.map((crop) => crop.weightUnits))),
          BigInt(now),
        );
      }
      this.statements.touchProfile.run(BigInt(now), userId);
      return {
        status: 'ok',
        plotNumbers: readyPlots,
        plotCount: readyPlots.length,
        itemId: 'carrot',
        amount: BigInt(harvested.length),
        cropInstances: harvested,
      };
    }).immediate;

    this.shovelTransaction = db.transaction((userId, plotNumbers, now) => {
      this.ensureProfileRecords(userId, now);
      const requested = Array.isArray(plotNumbers) ? plotNumbers : [];
      const normalized = normalizePlotNumbers(requested);
      if (!normalized.length || normalized.length !== requested.length) return { status: 'invalid-plots' };
      const rows = normalized.map((plotNumber) => this.statements.plot.get(userId, BigInt(plotNumber)));
      if (rows.some((plot) => !plot)) return { status: 'invalid-plots' };
      const grouped = groupCropsByPlot(this.plantedCropInstancesForOwner(userId));
      const occupied = normalized.filter((plotNumber) => grouped.has(plotNumber));
      if (!occupied.length) return { status: 'nothing-occupied' };
      let deletedCount = 0;
      for (const plotNumber of occupied) {
        const deleted = this.statements.shovelPlot.run(userId, BigInt(plotNumber));
        deletedCount += Number(deleted.changes);
        this.statements.touchPlot.run(BigInt(now), userId, BigInt(plotNumber));
      }
      this.statements.touchProfile.run(BigInt(now), userId);
      return {
        status: 'ok',
        plotNumbers: occupied,
        plotCount: occupied.length,
        deletedCount,
      };
    }).immediate;

    this.sellTransaction = db.transaction((userId, cropIds, operationKey, now) => {
      this.ensureProfileRecords(userId, now);
      const priorRow = this.statements.operation.get(operationKey);
      if (priorRow) {
        if (priorRow.owner_user_id !== userId || priorRow.operation_kind !== 'crop-sale') {
          return { status: 'invalid-operation', duplicate: false };
        }
        return operationResult(priorRow);
      }
      const requested = Array.isArray(cropIds) ? cropIds.map((id) => String(id || '')) : [];
      const uniqueIds = [...new Set(requested)];
      if (!uniqueIds.length) return { status: 'empty', duplicate: false };
      if (uniqueIds.length !== requested.length || uniqueIds.some((id) => !id)) {
        return { status: 'invalid-crops', duplicate: false };
      }
      const rows = uniqueIds.map((id) => this.statements.cropById.get(id));
      if (rows.some((row) => !row || row.owner_user_id !== userId || row.state !== 'inventory')) {
        return { status: 'invalid-crops', duplicate: false };
      }
      const total = rows.reduce((sum, row) => sum + row.stored_value, 0n);
      const profile = this.statements.profile.get(userId);
      const balance = profile.coin_balance + total;
      if (balance > SQLITE_INTEGER_MAX) throw new RangeError('Farming balance exceeds SQLite signed 64-bit range.');
      for (const row of rows) {
        const deleted = this.statements.deleteInventoryCrop.run(row.id, userId);
        if (Number(deleted.changes) !== 1) throw new Error('Farming inventory changed while completing the sale.');
      }
      this.statements.updateBalance.run(balance, BigInt(now), userId);
      const result = { status: 'ok', itemCount: rows.length, total, balance, duplicate: false };
      this.statements.saveOperation.run(operationKey, userId, 'crop-sale', JSON.stringify({
        status: result.status,
        itemCount: result.itemCount,
        total: String(total),
        balance: String(balance),
      }), BigInt(now));
      return result;
    }).immediate;
  }

  ensureProfileRecords(userId, now) {
    this.statements.insertProfile.run(userId, BigInt(now), BigInt(now));
    for (let plotNumber = 1; plotNumber <= 9; plotNumber += 1) {
      this.statements.insertPlot.run(userId, BigInt(plotNumber), BigInt(now));
    }
    const granted = this.statements.grantStarter.run(BigInt(now), userId);
    if (Number(granted.changes) === 1) {
      this.statements.addStack.run(userId, STARTER_ITEM_ID, STARTER_ITEM_QUANTITY, BigInt(now));
    }
    return this.statements.profile.get(userId);
  }

  ensureProfile(userId, now = Date.now()) {
    const id = String(userId);
    this.ensureProfileTransaction(id, now);
    return this.profile(id);
  }

  profile(userId) {
    const row = this.statements.profile.get(String(userId));
    return row ? {
      userId: row.user_id,
      balance: row.coin_balance,
      starterGranted: Boolean(row.starter_granted),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    } : null;
  }

  plantedCropInstancesForOwner(userId) {
    return this.statements.plantedCrops.all(String(userId)).map(cropInstanceRecord);
  }

  plots(userId, now = Date.now()) {
    const id = String(userId);
    this.ensureProfile(id, now);
    const grouped = groupCropsByPlot(this.plantedCropInstancesForOwner(id));
    return this.statements.plots.all(id).map((row) => plotRecord(row, grouped.get(Number(row.plot_number)) || []));
  }

  itemStacks(userId, now = Date.now()) {
    const id = String(userId);
    this.ensureProfile(id, now);
    return this.statements.stacks.all(id).map(stackRecord).filter((stack) => stack.item);
  }

  inventoryCropInstances(userId, now = Date.now()) {
    const id = String(userId);
    this.ensureProfile(id, now);
    return this.statements.inventoryCrops.all(id).map(cropInstanceRecord).filter((crop) => crop.item);
  }

  inventoryState(userId, now = Date.now()) {
    return {
      crops: this.inventoryCropInstances(userId, now),
      stacks: this.itemStacks(userId, now),
    };
  }

  cropStatistics(userId, cropId, now = Date.now()) {
    const id = String(userId);
    const normalizedCropId = String(cropId);
    this.ensureProfile(id, now);
    return cropStatisticsRecord(this.statements.cropStatistics.get(id, normalizedCropId), id, normalizedCropId);
  }

  itemQuantity(userId, itemId, now = Date.now()) {
    const id = String(userId);
    this.ensureProfile(id, now);
    return stackRecord(this.statements.stack.get(id, String(itemId)))?.quantity || 0n;
  }

  plant(userId, plotNumbers, itemId, createAnchors, createCrop, now = Date.now()) {
    let cropFactory = createCrop;
    let timestamp = now;
    if (typeof cropFactory !== 'function') {
      if (cropFactory != null) timestamp = cropFactory;
      cropFactory = () => generateCarrot();
    }
    return this.plantTransaction(String(userId), plotNumbers, String(itemId), createAnchors, cropFactory, timestamp);
  }

  harvest(userId, plotNumbers, now = Date.now()) {
    return this.harvestTransaction(String(userId), plotNumbers, now);
  }

  shovel(userId, plotNumbers, now = Date.now()) {
    return this.shovelTransaction(String(userId), plotNumbers, now);
  }

  sellCrops(userId, cropIds, operationKey, now = Date.now()) {
    return this.sellTransaction(String(userId), cropIds, String(operationKey), now);
  }
}

module.exports = {
  FarmingGameRepository,
  SQLITE_INTEGER_MAX,
  cropInstanceRecord,
  cropStatisticsRecord,
  normalizePlotNumbers,
  parseAnchors,
  plotRecord,
  stackRecord,
};
