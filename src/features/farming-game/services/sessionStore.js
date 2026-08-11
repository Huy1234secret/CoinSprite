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

  createIndex(ownerId, data = {}) {
    const id = token();
    const view = {
      id,
      kind: 'index',
      ownerId: String(ownerId),
      page: 1,
      maxPage: Math.max(1, Math.floor(Number(data.maxPage) || 1)),
      lastActivityAt: this.clock(),
    };
    this.records.set(id, view);
    return view;
  }

  createUpgrade(ownerId) {
    const id = token();
    const view = {
      id,
      kind: 'upgrade',
      ownerId: String(ownerId),
      lastActivityAt: this.clock(),
    };
    this.records.set(id, view);
    return view;
  }
}

class FarmingSaleSessionStore extends FarmingExpiringStore {
  constructor(options = {}) {
    super(options);
    this.byToken = new Map();
  }

  prune() {
    super.prune();
    for (const [sessionToken, ownerId] of this.byToken) {
      if (!this.records.has(ownerId)) this.byToken.delete(sessionToken);
    }
  }

  create(ownerId, data = {}) {
    this.prune();
    const key = String(ownerId);
    if (this.records.has(key)) return null;
    const session = {
      id: token(),
      kind: 'sale',
      ownerId: key,
      selectedCropIds: new Set(),
      currentPage: 1,
      messageId: data.messageId || '',
      processing: false,
      lastActivityAt: this.clock(),
    };
    this.records.set(key, session);
    this.byToken.set(session.id, key);
    return session;
  }

  getByToken(sessionToken, options = {}) {
    this.prune();
    const ownerId = this.byToken.get(String(sessionToken));
    return ownerId ? this.get(ownerId, options) : null;
  }

  has(ownerId) {
    return Boolean(this.get(ownerId, { touch: false }));
  }

  delete(ownerId) {
    const session = this.records.get(String(ownerId));
    if (session) this.byToken.delete(session.id);
    return super.delete(ownerId);
  }

  clear() {
    super.clear();
    this.byToken.clear();
  }
}

module.exports = {
  FIFTEEN_MINUTES,
  FarmingExpiringStore,
  FarmingSaleSessionStore,
  FarmingViewStore,
};
