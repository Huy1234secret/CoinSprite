const {
  STARTER_ITEM_ID,
  STARTER_ITEM_QUANTITY,
  getItem,
} = require('../data/items');
const { growthStage } = require('../utils/growth');
const { validPlotAnchors } = require('../utils/anchors');

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

function plotRecord(row) {
  if (!row) return null;
  return {
    ownerUserId: row.owner_user_id,
    plotNumber: Number(row.plot_number),
    cropId: row.crop_id || null,
    plantedAt: row.planted_at == null ? null : Number(row.planted_at),
    anchors: parseAnchors(row.anchors_json),
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
        WHERE owner_user_id = ? AND quantity > 0 ORDER BY item_id`),
      stack: db.prepare('SELECT * FROM farm_item_stacks WHERE owner_user_id = ? AND item_id = ?'),
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
      plantPlot: db.prepare(`UPDATE farm_plots SET crop_id = ?, planted_at = ?, anchors_json = ?, updated_at = ?
        WHERE owner_user_id = ? AND plot_number = ? AND crop_id IS NULL`),
      clearPlot: db.prepare(`UPDATE farm_plots SET crop_id = NULL, planted_at = NULL, anchors_json = NULL, updated_at = ?
        WHERE owner_user_id = ? AND plot_number = ? AND crop_id IS NOT NULL`),
      touchProfile: db.prepare('UPDATE farm_profiles SET updated_at = ? WHERE user_id = ?'),
    };

    this.ensureProfileTransaction = db.transaction((userId, now) => this.ensureProfileRecords(userId, now)).immediate;

    this.plantTransaction = db.transaction((userId, plotNumbers, itemId, createAnchors, now) => {
      this.ensureProfileRecords(userId, now);
      const requested = Array.isArray(plotNumbers) ? plotNumbers : [];
      const normalized = normalizePlotNumbers(requested);
      if (!normalized.length || normalized.length !== requested.length) return { status: 'invalid-plots' };
      const item = getItem(itemId);
      if (!item || !item.itemTypes.includes('seed') || !item.plantableCropId) return { status: 'invalid-item' };
      const plots = normalized.map((plotNumber) => plotRecord(this.statements.plot.get(userId, BigInt(plotNumber))));
      if (plots.some((plot) => !plot)) return { status: 'invalid-plots' };
      if (plots.some((plot) => plot.cropId)) return { status: 'plots-changed' };
      const stack = stackRecord(this.statements.stack.get(userId, item.id));
      const required = BigInt(normalized.length);
      if (!stack || stack.quantity < required) {
        return { status: 'insufficient', required, available: stack?.quantity || 0n };
      }
      const anchorsByPlot = normalized.map((plotNumber) => {
        const anchors = createAnchors(plotNumber);
        if (!validPlotAnchors(plotNumber, anchors)) throw new Error(`Invalid anchors generated for plot ${plotNumber}.`);
        return anchors;
      });
      this.statements.setStack.run(userId, item.id, stack.quantity - required, BigInt(now));
      normalized.forEach((plotNumber, index) => {
        const changed = this.statements.plantPlot.run(
          item.plantableCropId,
          BigInt(now),
          JSON.stringify(anchorsByPlot[index]),
          BigInt(now),
          userId,
          BigInt(plotNumber),
        );
        if (Number(changed.changes) !== 1) throw new Error('Farm changed while planting.');
      });
      this.statements.touchProfile.run(BigInt(now), userId);
      return {
        status: 'ok',
        itemId: item.id,
        cropId: item.plantableCropId,
        plotNumbers: normalized,
        plantedAt: now,
        remaining: stack.quantity - required,
      };
    }).immediate;

    this.harvestTransaction = db.transaction((userId, plotNumbers, now) => {
      this.ensureProfileRecords(userId, now);
      const requested = Array.isArray(plotNumbers) ? plotNumbers : [];
      const normalized = normalizePlotNumbers(requested);
      if (!normalized.length || normalized.length !== requested.length) return { status: 'invalid-plots' };
      const plots = normalized.map((plotNumber) => plotRecord(this.statements.plot.get(userId, BigInt(plotNumber))));
      if (plots.some((plot) => !plot)) return { status: 'invalid-plots' };
      const readyPlots = plots.filter((plot) => plot.cropId === 'carrot' && growthStage(plot.plantedAt, now) === 6);
      if (!readyPlots.length) return { status: 'nothing-ready' };
      const amount = BigInt(readyPlots.length * 5);
      const existing = stackRecord(this.statements.stack.get(userId, 'carrot'))?.quantity || 0n;
      if (existing + amount > SQLITE_INTEGER_MAX) throw new RangeError('Farming item quantity exceeds SQLite signed 64-bit range.');
      this.statements.addStack.run(userId, 'carrot', amount, BigInt(now));
      for (const plot of readyPlots) {
        const cleared = this.statements.clearPlot.run(BigInt(now), userId, BigInt(plot.plotNumber));
        if (Number(cleared.changes) !== 1) throw new Error('Farm changed while harvesting.');
      }
      this.statements.touchProfile.run(BigInt(now), userId);
      return {
        status: 'ok',
        plotNumbers: readyPlots.map((plot) => plot.plotNumber),
        plotCount: readyPlots.length,
        itemId: 'carrot',
        amount,
      };
    }).immediate;

    this.shovelTransaction = db.transaction((userId, plotNumbers, now) => {
      this.ensureProfileRecords(userId, now);
      const requested = Array.isArray(plotNumbers) ? plotNumbers : [];
      const normalized = normalizePlotNumbers(requested);
      if (!normalized.length || normalized.length !== requested.length) return { status: 'invalid-plots' };
      const plots = normalized.map((plotNumber) => plotRecord(this.statements.plot.get(userId, BigInt(plotNumber))));
      if (plots.some((plot) => !plot)) return { status: 'invalid-plots' };
      const occupied = plots.filter((plot) => plot.cropId);
      if (!occupied.length) return { status: 'nothing-occupied' };
      for (const plot of occupied) {
        const cleared = this.statements.clearPlot.run(BigInt(now), userId, BigInt(plot.plotNumber));
        if (Number(cleared.changes) !== 1) throw new Error('Farm changed while shoveling.');
      }
      this.statements.touchProfile.run(BigInt(now), userId);
      return {
        status: 'ok',
        plotNumbers: occupied.map((plot) => plot.plotNumber),
        plotCount: occupied.length,
      };
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
      starterGranted: Boolean(row.starter_granted),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    } : null;
  }

  plots(userId, now = Date.now()) {
    const id = String(userId);
    this.ensureProfile(id, now);
    return this.statements.plots.all(id).map(plotRecord);
  }

  itemStacks(userId, now = Date.now()) {
    const id = String(userId);
    this.ensureProfile(id, now);
    return this.statements.stacks.all(id).map(stackRecord).filter((stack) => stack.item);
  }

  itemQuantity(userId, itemId, now = Date.now()) {
    const id = String(userId);
    this.ensureProfile(id, now);
    return stackRecord(this.statements.stack.get(id, String(itemId)))?.quantity || 0n;
  }

  plant(userId, plotNumbers, itemId, createAnchors, now = Date.now()) {
    return this.plantTransaction(String(userId), plotNumbers, String(itemId), createAnchors, now);
  }

  harvest(userId, plotNumbers, now = Date.now()) {
    return this.harvestTransaction(String(userId), plotNumbers, now);
  }

  shovel(userId, plotNumbers, now = Date.now()) {
    return this.shovelTransaction(String(userId), plotNumbers, now);
  }
}

module.exports = {
  FarmingGameRepository,
  SQLITE_INTEGER_MAX,
  normalizePlotNumbers,
  parseAnchors,
  plotRecord,
  stackRecord,
};
