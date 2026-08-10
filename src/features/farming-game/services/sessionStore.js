const { randomBytes } = require('crypto');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function token() {
  return randomBytes(9).toString('base64url');
}

class FarmingExpiringStore {
  constructor(options = {}) {
    this.clock = options.clock || Date.now;
    this.ttlMs = options.ttlMs || FIFTEEN_MINUTES;
    this.records = new Map();
  }

  prune() {
    const now = this.clock();
    for (const [id, record] of this.records) {
      if (now - record.lastActivityAt >= this.ttlMs) this.records.delete(id);
    }
  }

  get(id, options = {}) {
    this.prune();
    const record = this.records.get(String(id)) || null;
    if (record && options.touch !== false) record.lastActivityAt = this.clock();
    return record;
  }

  delete(id) {
    return this.records.delete(String(id));
  }

  clear() {
    this.records.clear();
  }
}

class FarmingViewStore extends FarmingExpiringStore {
  createFarm(ownerId, data = {}) {
    const id = token();
    const view = {
      id,
      kind: 'farm',
      ownerId: String(ownerId),
      selectedPlots: new Set(),
      editOriginal: data.editOriginal || null,
      lastActivityAt: this.clock(),
    };
    this.records.set(id, view);
    return view;
  }

  createInventory(ownerId, data = {}) {
    const id = token();
    const view = {
      id,
      kind: 'inventory',
      ownerId: String(ownerId),
      type: 'crops',
      cropPage: 1,
      cropFilters: {},
      otherPage: 1,
      otherFilters: {},
      editOriginal: data.editOriginal || null,
      lastActivityAt: this.clock(),
    };
    this.records.set(id, view);
    return view;
  }
}

class FarmingActionStore extends FarmingExpiringStore {
  create(ownerId, data = {}) {
    const id = token();
    const action = {
      id,
      ownerId: String(ownerId),
      used: false,
      ...data,
      lastActivityAt: this.clock(),
    };
    this.records.set(id, action);
    return action;
  }

  claim(id, ownerId) {
    const action = this.get(id);
    if (!action || action.ownerId !== String(ownerId) || action.used) return null;
    action.used = true;
    return action;
  }
}

module.exports = {
  FIFTEEN_MINUTES,
  FarmingActionStore,
  FarmingExpiringStore,
  FarmingViewStore,
};
