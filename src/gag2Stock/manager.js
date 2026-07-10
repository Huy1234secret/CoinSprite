const { logCommandSystem } = require('../commandLogger');
const { CHECK_INTERVAL_MS, POST_CHANNEL_ID, STATE_PATH, STOCK_API_URL } = require('./config');
const { fetchStockPayload } = require('./source');
const { buildPostKey, buildStockPayload, buildUnavailablePayload } = require('./stockPayload');
const { loadState, saveState } = require('./stateStore');

class Gag2StockPoster {
  constructor(client, options = {}) {
    this.client = client;
    this.channelId = options.channelId || POST_CHANNEL_ID;
    this.checkIntervalMs = options.checkIntervalMs || CHECK_INTERVAL_MS;
    this.fetchStockPayload = options.fetchStockPayload || fetchStockPayload;
    this.now = options.now || (() => Date.now());
    this.sourceUrl = options.sourceUrl || STOCK_API_URL;
    this.statePath = options.statePath || STATE_PATH;
    this.inFlight = false;
    this.timer = null;
  }

  async start() {
    if (this.timer) return this;
    await this.tick();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        logCommandSystem(`GAG2 stock tick failed: ${error?.message || 'unknown error'}`);
      });
    }, this.checkIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async getChannel() {
    const channel = this.client?.channels?.cache?.get?.(this.channelId)
      || await this.client?.channels?.fetch?.(this.channelId).catch(() => null);
    if (!channel || typeof channel.send !== 'function') {
      throw new Error(`GAG2 stock channel ${this.channelId} is unavailable or not sendable`);
    }
    return channel;
  }

  async tick() {
    if (this.inFlight) return null;
    this.inFlight = true;

    try {
      const state = loadState(this.statePath);
      const stockPayload = await this.fetchStockPayload({ url: this.sourceUrl });
      const postKey = buildPostKey(stockPayload);
      if (state.lastPostedKey === postKey) return null;

      const channel = await this.getChannel();
      const message = await channel.send(buildStockPayload(stockPayload, { sourceUrl: this.sourceUrl }));
      saveState({
        ...state,
        channelId: this.channelId,
        lastMessageId: message?.id || null,
        lastPostedAt: new Date(this.now()).toISOString(),
        lastPostedKey: postKey,
      }, this.statePath);
      logCommandSystem(`GAG2 stock posted to ${this.channelId}: ${postKey}`);
      return message;
    } catch (error) {
      await this.postUnavailableOnce(error).catch((postError) => {
        logCommandSystem(`GAG2 stock unavailable notice failed: ${postError?.message || 'unknown error'}`);
      });
      logCommandSystem(`GAG2 stock failed: ${error?.message || 'unknown error'}`);
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  async postUnavailableOnce(error) {
    const state = loadState(this.statePath);
    const dayBucket = new Date(this.now()).toISOString().slice(0, 10);
    const postKey = `unavailable:${dayBucket}`;
    if (state.lastPostedKey === postKey) return null;

    const channel = await this.getChannel();
    const message = await channel.send(buildUnavailablePayload(error?.message || 'Unknown error', this.now()));
    saveState({
      ...state,
      channelId: this.channelId,
      lastMessageId: message?.id || null,
      lastPostedAt: new Date(this.now()).toISOString(),
      lastPostedKey: postKey,
    }, this.statePath);
    return message;
  }
}

let activePoster = null;

async function startGag2StockPoster(client, options = {}) {
  if (activePoster) return activePoster;
  activePoster = new Gag2StockPoster(client, options);
  await activePoster.start();
  return activePoster;
}

module.exports = {
  Gag2StockPoster,
  startGag2StockPoster,
};
