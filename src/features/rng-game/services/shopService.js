const { randomUUID } = require('crypto');
const { SHOP_ITEM_CONFIG_VERSION } = require('../data/items');
const { nextRestockAt, RESTOCK_INTERVAL_MS } = require('../repositories/itemPetRepository');

const SHOP_PAGE_SIZE = 6;

class ShopService {
  constructor(options) {
    this.repository = options.repository;
    this.renderer = options.renderer;
    this.clock = options.clock || Date.now;
  }

  state() {
    return this.repository.shopState(this.clock());
  }

  async page(_userId, pageNumber = 1) {
    const state = this.state();
    const maxPage = Math.max(1, Math.ceil(state.items.length / SHOP_PAGE_SIZE));
    const page = Math.max(1, Math.min(maxPage, Math.floor(Number(pageNumber) || 1)));
    const items = state.items.slice((page - 1) * SHOP_PAGE_SIZE, page * SHOP_PAGE_SIZE);
    const image = await this.renderer.render(items, {
      restockEpoch: state.restockEpoch,
      page,
      catalogueVersion: SHOP_ITEM_CONFIG_VERSION,
    });
    return { ...state, page, maxPage, items, image };
  }

  purchase(userId, itemId, amount, operationKey, preview) {
    return this.repository.purchase(userId, itemId, amount, operationKey, preview, this.clock());
  }
}

class ShopRestockScheduler {
  constructor(options) {
    this.repository = options.repository;
    this.clock = options.clock || Date.now;
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.onError = options.onError || ((error) => console.error('RNG shop restock scheduler failed:', error?.message || error));
    this.ownerId = options.ownerId || randomUUID();
    this.timer = null;
    this.running = false;
  }

  runBoundary(now = this.clock()) {
    return this.repository.ensureRestock(now);
  }

  scheduleNext() {
    if (!this.running) return;
    const now = this.clock();
    const delay = Math.max(1, nextRestockAt(now) - now);
    this.timer = this.setTimer(() => {
      try {
        this.runBoundary(this.clock());
      } catch (error) {
        this.onError(error);
      } finally {
        this.scheduleNext();
      }
    }, delay);
    this.timer?.unref?.();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.repository.ensureRestock(this.clock());
    this.scheduleNext();
  }

  stop() {
    this.running = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }
}

module.exports = { RESTOCK_INTERVAL_MS, SHOP_PAGE_SIZE, ShopRestockScheduler, ShopService };
