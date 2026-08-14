const { randomUUID } = require('crypto');
const { nextRestockAt, RESTOCK_INTERVAL_MS } = require('../repositories/itemPetRepository');
const { personalizedCatalogue } = require('./shopPricingService');

const SHOP_PAGE_SIZE = 6;

class ShopService {
  constructor(options) {
    this.repository = options.repository;
    this.renderer = options.renderer;
    this.clock = options.clock || Date.now;
  }

  state(userId) {
    const state = this.repository.shopState(this.clock());
    const player = this.repository.gameRepository.getPlayer(String(userId), this.clock());
    const quotes = new Map(personalizedCatalogue(
      state.items,
      player.luckTier,
      player.bigCropTier,
    ).map((quote) => [quote.itemId, quote]));
    return {
      ...state,
      pricedLuckTier: player.luckTier,
      pricedBigTier: player.bigCropTier,
      items: state.items.map((item) => ({
        ...item,
        price: quotes.get(item.id).price,
        pricing: quotes.get(item.id),
      })),
    };
  }

  async page(userId, pageNumber = 1) {
    const state = this.state(userId);
    const maxPage = Math.max(1, Math.ceil(state.items.length / SHOP_PAGE_SIZE));
    const page = Math.max(1, Math.min(maxPage, Math.floor(Number(pageNumber) || 1)));
    const items = state.items.slice((page - 1) * SHOP_PAGE_SIZE, page * SHOP_PAGE_SIZE);
    const cards = await Promise.all(items.map(async (item) => ({
      item,
      image: await this.renderer.render(item, state.restockEpoch),
    })));
    return { ...state, page, maxPage, items, cards };
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
