const { randomBytes } = require('crypto');

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function token() {
  return randomBytes(9).toString('base64url');
}

class ExpiringStore {
  constructor(options = {}) {
    this.clock = options.clock || Date.now;
    this.ttlMs = options.ttlMs || FIFTEEN_MINUTES;
    this.records = new Map();
  }

  prune() {
    const now = this.clock();
    for (const [key, record] of this.records) {
      if (now - record.lastActivityAt >= this.ttlMs) this.records.delete(key);
    }
  }

  get(key, options = {}) {
    this.prune();
    const record = this.records.get(String(key));
    if (record && options.touch !== false) record.lastActivityAt = this.clock();
    return record || null;
  }

  delete(key) {
    return this.records.delete(String(key));
  }

  clear() {
    this.records.clear();
  }
}

class SaleSessionStore extends ExpiringStore {
  constructor(options = {}) {
    super(options);
    this.byToken = new Map();
  }

  prune() {
    super.prune();
    for (const [sessionToken, userId] of this.byToken) {
      if (!this.records.has(userId)) this.byToken.delete(sessionToken);
    }
  }

  create(userId, data = {}) {
    this.prune();
    const key = String(userId);
    if (this.records.has(key)) return null;
    const session = {
      id: token(),
      userId: key,
      selectedItemIds: new Set(),
      currentPage: 1,
      filters: {},
      messageId: data.messageId || '',
      interactionId: data.interactionId || '',
      channelId: data.channelId || '',
      processing: false,
      lastActivityAt: this.clock(),
    };
    this.records.set(key, session);
    this.byToken.set(session.id, key);
    return session;
  }

  getByToken(sessionToken, options = {}) {
    this.prune();
    const userId = this.byToken.get(String(sessionToken));
    return userId ? this.get(userId, options) : null;
  }

  has(userId) {
    return Boolean(this.get(userId, { touch: false }));
  }

  delete(userId) {
    const session = this.records.get(String(userId));
    if (session) this.byToken.delete(session.id);
    return super.delete(userId);
  }
}

class ViewStore extends ExpiringStore {
  create(ownerId, data = {}) {
    const id = token();
    const view = {
      id,
      ownerId: String(ownerId),
      page: 1,
      filters: {},
      editOriginal: data.editOriginal || null,
      lastActivityAt: this.clock(),
    };
    this.records.set(id, view);
    return view;
  }

  forOwner(ownerId) {
    this.prune();
    const id = String(ownerId);
    return [...this.records.values()].filter((view) => view.ownerId === id);
  }
}

class ActionStore extends ExpiringStore {
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

module.exports = { ActionStore, ExpiringStore, FIFTEEN_MINUTES, SaleSessionStore, ViewStore };
