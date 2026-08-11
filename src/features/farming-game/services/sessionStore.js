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
      cropFilters: { name: '', rarity: '', itemTypes: [] },
      otherPage: 1,
      otherFilters: { name: '', rarity: '', itemTypes: [] },
      lastActivityAt: this.clock(),
    };
    this.records.set(id, view);
    return view;
  }
}

module.exports = {
  FIFTEEN_MINUTES,
  FarmingExpiringStore,
  FarmingViewStore,
};
